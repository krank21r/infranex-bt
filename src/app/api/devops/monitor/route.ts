import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchMonitoringOverview } from "@/lib/infranex/monitoring";
import { getDaemonView } from "@/lib/infranex/daemon-bridge";
import { listTriggerEvents } from "@/lib/infranex/triggers";
import { DEVOPS_THRESHOLDS } from "@/lib/infranex/devops-monitor";
import { SERVICE_THRESHOLDS } from "@/lib/infranex/service-health";
import { computeMinerHealth, type MinerHealth } from "@/lib/infranex/health-score";
import {
  buildMinerStrategyPosture,
  MINDSET_THRESHOLDS,
  type MinerStrategyPosture,
} from "@/lib/infranex/miner-mindset";
import { fetchLiveSnapshot, type LiveNetworkSnapshot } from "@/lib/infranex/chain";
import { computeRunway, SS58_RE, type RunwayAssessment } from "@/lib/infranex/runway";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/devops/monitor — DEVOPS-1 aggregate payload for the DevOps view.
 *
 * One call returns everything the live ops board needs:
 *   - per started miner: daemon status + latest GPU sample + 60-sample
 *     history (sparklines), UID/chain facts, alerts, registration state
 *   - open + recent trigger events (recommendations inbox + change feed)
 *   - the devops-monitor worker's last pass (proof the engine is alive)
 *   - thresholds so the UI renders the same lines the engine enforces
 *
 * 10s in-memory micro-cache — the client polls every 20s; this keeps
 * double-tab / remount storms cheap.
 */

const GPU_HISTORY_WINDOW = 60;
const CACHE_TTL_MS = 10_000;

interface Cached {
  at: number;
  payload: DevopsMonitorPayload;
}
const globalForCache = globalThis as unknown as { __devopsMonitorCache: Cached | undefined };

// --- Payload types (client mirrors live in use-devops-monitor.ts) ----------

export interface DevopsMiner {
  deploymentId: string;
  minerName: string;
  netuid: number;
  subnetName: string;
  gpuModel: string;
  provider: string;
  mode: string;
  status: string;
  providerPodId: string | null;
  monthlyCost: number;
  createdAt: string;
  daemon: {
    status: string;
    lastSeenAt: string | null;
    pendingCommands: number;
    processAlive: boolean | null;
  } | null;
  gpu: {
    daemonStatus: string;
    utilPct: number | null;
    memUsedMb: number | null;
    memTotalMb: number | null;
    tempC: number | null;
    processAlive: boolean | null;
    at: string | null;
  } | null;
  gpuHistory: { at: string; tempC: number | null; utilPct: number | null }[];
  uid: {
    uid: number | null;
    incentive: number | null;
    emission: number | null;
    riskLevel: "healthy" | "warning" | "critical";
    riskCodes: string[];
  } | null;
  registration: { state: string | null; registeredUid: number | null };
  chain: {
    found: boolean;
    incentive: number | null;
    emissionPerMonthUsd: number | null;
    netProfitPerMonthUsd: number | null;
    roiPercent: number | null;
  };
  alerts: { level: string; code: string; message: string }[];
  strategy: MinerStrategyPosture;
  /** TIER1-1 — composite 0-100 health score with per-factor breakdown. */
  health: MinerHealth;
  /** TIER1-1 — last 40 miner log lines, newest first. */
  logs: { at: string; severity: string; source: string; message: string }[];
  /** TIER1-1 — latest Doctor (10-step inspector) facts for the host machine. */
  machine: {
    hostId: string;
    name: string;
    transport: string;
    status: string;
    os: string | null;
    gpuName: string | null;
    driverCuda: string | null;
    dockerVersion: string | null;
  } | null;
  service: {
    probe: {
      endpoint: string | null;
      mode: string;
      ok: boolean;
      httpStatus: number | null;
      ttfbMs: number | null;
      totalMs: number | null;
      errorKind: string | null;
      at: string;
    } | null;
    probeHistory: { at: string; ok: boolean; totalMs: number | null }[];
    latencyP50Ms: number | null;
    latencyP95Ms: number | null;
    successRatePct: number | null;
    probedCount: number;
    traffic: {
      windowMinutes: number | null;
      requests: number | null;
      distinctValidators: number | null;
      topValidatorHotkey: string | null;
      topValidatorCount: number | null;
      logFound: boolean;
      at: string;
    } | null;
  };
  /** TIER4 / RUNWAY-1 — immunity runway (verdict, margins, T-minus). */
  runway: RunwayAssessment | null;
}

export interface DevopsMonitorPayload {
  ok: true;
  fetchedAt: string;
  autopilot: {
    rules: {
      id: string;
      name: string;
      kind: string;
      minSeverity: string;
      maxPerHour: number;
      enabled: boolean;
    }[];
    recentActions: { id: string; kind: string; title: string; at: string; ruleName: string | null }[];
  };
  benchmarks: {
    deploymentId: string;
    minerName: string;
    mode: string;
    latest: { at: string; p50Ms: number | null; p95Ms: number | null; successPct: number; samples: number } | null;
    baselineP50Ms: number | null;
    runs: number;
  }[];
  summary: {
    monitored: number;
    healthy: number;
    warning: number;
    critical: number;
    daemonsOnline: number;
    openRecommendations: number;
    /** TIER1-1 — fleet economics per day (spec §41). */
    infraCostUsdPerDay: number;
    revenueUsdPerDay: number;
    netUsdPerDay: number;
    avgHealthScore: number | null;
  };
  miners: DevopsMiner[];
  openEvents: unknown[];
  recentEvents: unknown[];
  lastPass: { at: string; status: string; durationMs: number; evaluated: number } | null;
  thresholds: typeof DEVOPS_THRESHOLDS;
  mindsetThresholds: typeof MINDSET_THRESHOLDS;
  serviceThresholds: typeof SERVICE_THRESHOLDS;
}

// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const cached = globalForCache.__devopsMonitorCache;
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json(cached.payload);
    }

    const [overview, events, snapshot] = await Promise.all([
      fetchMonitoringOverview(),
      listTriggerEvents().catch(() => ({ open: [], recent: [] })),
      fetchLiveSnapshot().catch(() => null) as Promise<LiveNetworkSnapshot | null>,
    ]);

    const started = overview.deployments.filter((d) => d.status === "started");
    const startedIds = started.map((d) => d.id);

    // Registration lifecycle lives on the deployment row itself. TIER1-1:
    // also pull ssh/pod ids so machine facts can be linked to GpuHost rows.
    const regRows = await db.deployment.findMany({
      where: { id: { in: startedIds } },
      select: {
        id: true,
        registrationState: true,
        registeredUid: true,
        registrationBlock: true,
        providerPodId: true,
        sshHost: true,
      },
    });
    const regById = new Map(regRows.map((r) => [r.id, r]));

    // Latest UID snapshot per started deployment (written by the UID-defense
    // pass every 90s — cheap DB read instead of live chain calls).
    const uidRows = startedIds.length
      ? await db.uidSnapshot.findMany({
          where: { deploymentId: { in: startedIds } },
          orderBy: { createdAt: "desc" },
        })
      : [];
    const latestUid = new Map<string, (typeof uidRows)[number]>();
    for (const r of uidRows) {
      if (!latestUid.has(r.deploymentId)) latestUid.set(r.deploymentId, r);
    }

    // GPU history per deployment (newest first → reverse for sparklines).
    const gpuRows = startedIds.length
      ? await db.gpuSample.findMany({
          where: { deploymentId: { in: startedIds } },
          orderBy: { createdAt: "desc" },
        })
      : [];
    const gpuByDep = new Map<string, typeof gpuRows>();
    for (const r of gpuRows) {
      const list = gpuByDep.get(r.deploymentId);
      if (list) list.push(r);
      else gpuByDep.set(r.deploymentId, [r]);
    }

    // DEVOPS-4 — probe history + validator traffic per deployment (newest
    // first; history sliced/reversed for the latency sparkline).
    const probeRows = startedIds.length
      ? await db.probeSample.findMany({
          where: { deploymentId: { in: startedIds } },
          orderBy: { createdAt: "desc" },
        })
      : [];
    const probeByDep = new Map<string, typeof probeRows>();
    for (const r of probeRows) {
      const list = probeByDep.get(r.deploymentId);
      if (list) list.push(r);
      else probeByDep.set(r.deploymentId, [r]);
    }
    const trafficRows = startedIds.length
      ? await db.trafficSample.findMany({
          where: { deploymentId: { in: startedIds } },
          orderBy: { createdAt: "desc" },
        })
      : [];
    const trafficByDep = new Map<string, typeof trafficRows[number]>();
    for (const r of trafficRows) {
      if (!trafficByDep.has(r.deploymentId)) trafficByDep.set(r.deploymentId, r);
    }

    // TIER1-1 — live miner logs (newest first, sliced to 40 per miner below).
    const logRows = startedIds.length
      ? await db.minerLog.findMany({
          where: { deploymentId: { in: startedIds } },
          orderBy: { at: "desc" },
          take: startedIds.length * 40,
        })
      : [];
    const logsByDep = new Map<string, typeof logRows>();
    for (const r of logRows) {
      const list = logsByDep.get(r.deploymentId);
      if (list) list.push(r);
      else logsByDep.set(r.deploymentId, [r]);
    }

    // TIER1-1 — GPU host inventory for machine facts (Doctor results).
    // Link by provider pod id first, then by ssh host address.
    const hostRows = await db.gpuHost.findMany();
    const hostByDep = new Map<string, (typeof hostRows)[number]>();
    for (const reg of regRows) {
      const match =
        (reg.providerPodId && hostRows.find((h) => h.providerPodId === reg.providerPodId)) ||
        (reg.sshHost && hostRows.find((h) => h.host === reg.sshHost));
      if (match) hostByDep.set(reg.id, match);
    }

    const miners: DevopsMiner[] = [];
    let healthy = 0;
    let warning = 0;
    let critical = 0;
    let daemonsOnline = 0;

    for (const dep of started) {
      const daemon = await getDaemonView(dep.id);
      if (daemon?.status === "online") daemonsOnline++;

      const history = (gpuByDep.get(dep.id) ?? []).slice(0, GPU_HISTORY_WINDOW);
      const latestGpu = history[0] ?? null;
      const uid = latestUid.get(dep.id) ?? null;
      const reg = regById.get(dep.id);

      const alerts = dep.monitoring.alerts;
      const gpuTemp = latestGpu?.tempC ?? null;
      const probes = (probeByDep.get(dep.id) ?? []).slice(0, 40);
      const latestProbe = probes[0] ?? null;
      const trafficLatest = trafficByDep.get(dep.id) ?? null;
      const depOpenEvents = events.open.filter((e) => e.deploymentId === dep.id);
      const openServiceKinds = new Set(depOpenEvents.map((e) => e.kind));
      const hasCritical =
        alerts.some((a) => a.level === "critical") ||
        uid?.riskLevel === "critical" ||
        (gpuTemp !== null && gpuTemp >= DEVOPS_THRESHOLDS.tempCriticalC) ||
        latestGpu?.processAlive === false ||
        (latestProbe !== null && latestProbe.ok === false) ||
        openServiceKinds.has("PROBE_FAIL") ||
        depOpenEvents.some((e) => e.kind === "RUNWAY" && e.severity === "critical");
      const hasWarning =
        alerts.some((a) => a.level === "warning") ||
        uid?.riskLevel === "warning" ||
        (gpuTemp !== null && gpuTemp >= DEVOPS_THRESHOLDS.tempWarnC) ||
        openServiceKinds.has("SERVICE_LATENCY") ||
        openServiceKinds.has("QUERY_DROUGHT") ||
        openServiceKinds.has("RUNWAY");

      if (hasCritical) critical++;
      else if (hasWarning) warning++;
      else healthy++;

      const service = (() => {
        const okMs = probes.filter((p) => p.ok).map((p) => p.totalMs).filter((v): v is number => v !== null);
        const sorted = [...okMs].sort((a, b) => a - b);
        const pct = (p: number) =>
          sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null;
        const successRatePct = probes.length
          ? Math.round((probes.filter((p) => p.ok).length / probes.length) * 100)
          : null;
        return {
          probe: latestProbe
            ? {
                endpoint: latestProbe.endpoint,
                mode: latestProbe.mode,
                ok: latestProbe.ok,
                httpStatus: latestProbe.httpStatus,
                ttfbMs: latestProbe.ttfbMs,
                totalMs: latestProbe.totalMs,
                errorKind: latestProbe.errorKind,
                at: latestProbe.createdAt.toISOString(),
              }
            : null,
          probeHistory: probes
            .slice(0, 30)
            .slice()
            .reverse()
            .map((p) => ({ at: p.createdAt.toISOString(), ok: p.ok, totalMs: p.totalMs })),
          latencyP50Ms: pct(50),
          latencyP95Ms: pct(95),
          successRatePct,
          probedCount: probes.length,
          traffic: trafficLatest
            ? {
                windowMinutes: trafficLatest.windowMinutes,
                requests: trafficLatest.requests,
                distinctValidators: trafficLatest.distinctValidators,
                topValidatorHotkey: trafficLatest.topValidatorHotkey,
                topValidatorCount: trafficLatest.topValidatorCount,
                logFound: trafficLatest.logFound,
                at: trafficLatest.createdAt.toISOString(),
              }
            : null,
        };
      })();

      // TIER1-1 — composite health score (pure scorer, same inputs the UI has).
      const silenceMs =
        daemon?.lastSeenAt != null ? Date.now() - new Date(daemon.lastSeenAt).getTime() : null;
      const health = computeMinerHealth({
        processAlive: latestGpu?.processAlive ?? null,
        hasDaemon: daemon !== null,
        daemonSilent:
          daemon != null &&
          (daemon.status === "unreachable" ||
            (silenceMs !== null && silenceMs > DEVOPS_THRESHOLDS.daemonSilenceMs)),
        tempC: latestGpu?.tempC ?? null,
        tempWarnC: DEVOPS_THRESHOLDS.tempWarnC,
        tempCriticalC: DEVOPS_THRESHOLDS.tempCriticalC,
        utilPct: latestGpu?.gpuUtilPct ?? null,
        utilFloorPct: DEVOPS_THRESHOLDS.utilFloorPct,
        probeOk: latestProbe?.ok ?? null,
        probeTotalMs: latestProbe?.totalMs ?? null,
        probeSuccessRatePct: service.successRatePct,
        trafficRequests: trafficLatest?.requests ?? null,
        queryDrought: openServiceKinds.has("QUERY_DROUGHT"),
        uidRisk: (uid?.riskLevel as "healthy" | "warning" | "critical" | null) ?? null,
      });

      // TIER1-1 — live logs (newest first) + machine facts from the Doctor.
      const logs = (logsByDep.get(dep.id) ?? []).slice(0, 40).map((l) => ({
        at: l.at.toISOString(),
        severity: l.severity,
        source: l.source,
        message: l.message,
      }));
      const hostRow = hostByDep.get(dep.id);
      const machine = hostRow
        ? (() => {
            let facts: Record<string, unknown> = {};
            try {
              facts = hostRow.hostInfo ? (JSON.parse(hostRow.hostInfo) as Record<string, unknown>) : {};
            } catch {
              facts = {};
            }
            const str = (k: string) => (typeof facts[k] === "string" ? (facts[k] as string) : null);
            return {
              hostId: hostRow.id,
              name: hostRow.name,
              transport: hostRow.transport,
              status: hostRow.status,
              os: str("os"),
              gpuName: str("gpuName"),
              driverCuda: str("driverCuda"),
              dockerVersion: str("dockerVersion"),
            };
          })()
        : null;

      // TIER4 / RUNWAY-1 — immunity runway for the card. DB-only here (the
      // authoritative chain-backed version runs in the 90s worker pass):
      // immunity clock from the chain snapshot's subnet metrics + the
      // deployment's registration block, trajectory from the UID history.
      const runway: RunwayAssessment | null = (() => {
        if (!dep.hotkey || !SS58_RE.test(dep.hotkey)) return null; // no valid registered hotkey — no on-chain clock
        const subnetMeta = snapshot?.subnets.find((s) => s.netuid === dep.netuid) ?? null;
        const incentiveHistory = uidRows
          .filter((r) => r.deploymentId === dep.id)
          .slice(0, 20)
          .reverse()
          .map((r) => r.incentive);
        return computeRunway({
          uid: uid?.uid ?? null,
          incentive: uid?.incentive ?? null,
          incentiveHistory,
          hyperparams: {
            immunityPeriod: subnetMeta?.immunityBlocks ?? null,
            maxAllowedUids: subnetMeta?.maxUids ?? null,
          },
          // LiveSubnetMetrics counts registered miners — the best DB-only
          // capacity proxy (the worker pass uses the authoritative cohort).
          registeredUids: subnetMeta?.minersCount ?? 0,
          registrationBlock: reg?.registrationBlock ?? null,
          blockNumber: snapshot?.blockNumber ?? null,
        });
      })();

      miners.push({
        deploymentId: dep.id,
        minerName: dep.minerName,
        netuid: dep.netuid,
        subnetName: dep.subnetName,
        gpuModel: dep.gpuModel,
        provider: dep.provider,
        mode: dep.mode,
        status: dep.status,
        providerPodId: dep.providerPodId,
        monthlyCost: dep.monitoring.rewards.costPerMonthUsd ?? dep.monthlyCost,
        createdAt: dep.createdAt,
        daemon: daemon
          ? {
              status: daemon.status,
              lastSeenAt: daemon.lastSeenAt,
              pendingCommands: daemon.pendingCommands,
              processAlive:
                typeof (daemon.telemetry as Record<string, unknown> | null)?.minerProcessAlive === "boolean"
                  ? ((daemon.telemetry as Record<string, unknown>).minerProcessAlive as boolean)
                  : null,
            }
          : null,
        gpu: latestGpu
          ? {
              daemonStatus: latestGpu.daemonStatus,
              utilPct: latestGpu.gpuUtilPct,
              memUsedMb: latestGpu.memUsedMb,
              memTotalMb: latestGpu.memTotalMb,
              tempC: latestGpu.tempC,
              processAlive: latestGpu.processAlive,
              at: latestGpu.createdAt.toISOString(),
            }
          : null,
        gpuHistory: history
          .slice()
          .reverse()
          .map((h) => ({
            at: h.createdAt.toISOString(),
            tempC: h.tempC,
            utilPct: h.gpuUtilPct,
          })),
        uid: uid
          ? {
              uid: uid.uid,
              incentive: uid.incentive,
              emission: uid.emission,
              riskLevel: uid.riskLevel as "healthy" | "warning" | "critical",
              riskCodes: JSON.parse(uid.riskCodesJson) as string[],
            }
          : null,
        registration: {
          state: reg?.registrationState ?? null,
          registeredUid: reg?.registeredUid ?? null,
        },
        chain: {
          found: dep.monitoring.chain.found,
          incentive: dep.monitoring.chain.incentive,
          emissionPerMonthUsd: dep.monitoring.rewards.emissionPerMonthUsd,
          netProfitPerMonthUsd: dep.monitoring.rewards.netProfitPerMonthUsd,
          roiPercent: dep.monitoring.rewards.roiPercent,
        },
        alerts,
        strategy: buildMinerStrategyPosture({
          netuid: dep.netuid,
          mode: dep.mode,
          uid: uid
            ? {
                riskLevel: uid.riskLevel,
                validatorTrust: uid.validatorTrust,
                consensus: uid.consensus,
              }
            : null,
          recentSamples: history.slice(0, 3).map((h) => ({
            utilPct: h.gpuUtilPct,
            memRatio:
              h.memTotalMb && h.memTotalMb > 0
                ? (h.memUsedMb ?? 0) / h.memTotalMb
                : null,
          })),
          openKinds: events.open
            .filter((e) => e.deploymentId === dep.id)
            .map((e) => e.kind),
          snapshot,
        }),
        health,
        logs,
        machine,
        service,
        runway,
      });
    }

    // Last devops-monitor worker run (proof of life for the board header).
    const workerRow = await db.workerStatus.findFirst({
      where: { workerName: "devops-monitor" },
      orderBy: { createdAt: "desc" },
    });

    // TIER1-1 — fleet economics per day (spec §41): infra cost vs mining revenue.
    const infraCostUsdPerDay =
      started.reduce((a, d) => a + (d.monitoring.rewards.costPerMonthUsd ?? d.monthlyCost), 0) / 30;
    const revenueUsdPerDay = started.reduce((a, d) => a + (d.monitoring.rewards.emissionPerDayUsd ?? 0), 0);
    const avgHealthScore = miners.length
      ? Math.round(miners.reduce((a, m) => a + m.health.score, 0) / miners.length)
      : null;

    // TIER3 — autopilot rules + recent auto-actions (evidence-stamped).
    const autopilotRules = await db.autopilotRule.findMany({ orderBy: { createdAt: "desc" } });
    const actedWithAuto = await db.triggerEvent.findMany({
      where: { status: "acted", evidenceJson: { contains: '"auto":' } },
      orderBy: { updatedAt: "desc" },
      take: 5,
    });
    const autopilotSection = {
      rules: autopilotRules.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        minSeverity: r.minSeverity,
        maxPerHour: r.maxPerHour,
        enabled: r.enabled,
      })),
      recentActions: actedWithAuto.map((e) => {
        let ruleName: string | null = null;
        try {
          const ev = JSON.parse(e.evidenceJson) as { auto?: { ruleName?: string } };
          ruleName = ev.auto?.ruleName ?? null;
        } catch {
          ruleName = null;
        }
        return { id: e.id, kind: e.kind, title: e.title, at: e.updatedAt.toISOString(), ruleName };
      }),
    };

    // TIER3 — benchmark summary per started deployment: latest run + the
    // rolling baseline the regression rule compares against.
    const benchmarkRows = await db.benchmarkRun.findMany({
      orderBy: { at: "desc" },
      take: 400,
    });
    const benchmarksSection = started.map((d) => {
      const runs = benchmarkRows.filter((r) => r.deploymentId === d.id);
      const latest = runs[0] ?? null;
      const baselineRows = runs.slice(1).filter((r) => (r.p50Ms ?? 0) > 0 && r.okCount > 0 && r.mode === "real").slice(0, 10);
      const baselineP50 = baselineRows.length
        ? Math.round([...baselineRows.map((r) => r.p50Ms as number)].sort((a, b) => a - b)[Math.floor((baselineRows.length - 1) / 2)])
        : null;
      return {
        deploymentId: d.id,
        minerName: d.minerName,
        mode: d.mode,
        latest: latest
          ? {
              at: latest.at.toISOString(),
              p50Ms: latest.p50Ms,
              p95Ms: latest.p95Ms,
              successPct: latest.successPct,
              samples: latest.samples,
            }
          : null,
        baselineP50Ms: baselineP50,
        runs: runs.length,
      };
    });

    const payload: DevopsMonitorPayload = {
      ok: true,
      fetchedAt: new Date().toISOString(),
      summary: {
        monitored: miners.length,
        healthy,
        warning,
        critical,
        daemonsOnline,
        openRecommendations: events.open.length,
        infraCostUsdPerDay,
        revenueUsdPerDay,
        netUsdPerDay: revenueUsdPerDay - infraCostUsdPerDay,
        avgHealthScore,
      },
      miners,
      openEvents: events.open,
      recentEvents: events.recent,
      autopilot: autopilotSection,
      benchmarks: benchmarksSection,
      lastPass: workerRow
        ? {
            at: workerRow.createdAt.toISOString(),
            status: workerRow.status,
            durationMs: workerRow.durationMs,
            evaluated: workerRow.tasksProcessed,
          }
        : null,
      thresholds: DEVOPS_THRESHOLDS,
      mindsetThresholds: MINDSET_THRESHOLDS,
      serviceThresholds: SERVICE_THRESHOLDS,
    };

    globalForCache.__devopsMonitorCache = { at: Date.now(), payload };
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
