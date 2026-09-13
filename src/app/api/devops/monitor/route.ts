import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchMonitoringOverview } from "@/lib/infranex/monitoring";
import { getDaemonView } from "@/lib/infranex/daemon-bridge";
import { listTriggerEvents } from "@/lib/infranex/triggers";
import { DEVOPS_THRESHOLDS } from "@/lib/infranex/devops-monitor";
import { SERVICE_THRESHOLDS } from "@/lib/infranex/service-health";
import {
  buildMinerStrategyPosture,
  MINDSET_THRESHOLDS,
  type MinerStrategyPosture,
} from "@/lib/infranex/miner-mindset";
import { fetchLiveSnapshot, type LiveNetworkSnapshot } from "@/lib/infranex/chain";

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
}

export interface DevopsMonitorPayload {
  ok: true;
  fetchedAt: string;
  summary: {
    monitored: number;
    healthy: number;
    warning: number;
    critical: number;
    daemonsOnline: number;
    openRecommendations: number;
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

    // Registration lifecycle lives on the deployment row itself.
    const regRows = await db.deployment.findMany({
      where: { id: { in: startedIds } },
      select: { id: true, registrationState: true, registeredUid: true },
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
      const openServiceKinds = new Set(
        events.open.filter((e) => e.deploymentId === dep.id).map((e) => e.kind)
      );
      const hasCritical =
        alerts.some((a) => a.level === "critical") ||
        uid?.riskLevel === "critical" ||
        (gpuTemp !== null && gpuTemp >= DEVOPS_THRESHOLDS.tempCriticalC) ||
        latestGpu?.processAlive === false ||
        (latestProbe !== null && latestProbe.ok === false) ||
        openServiceKinds.has("PROBE_FAIL");
      const hasWarning =
        alerts.some((a) => a.level === "warning") ||
        uid?.riskLevel === "warning" ||
        (gpuTemp !== null && gpuTemp >= DEVOPS_THRESHOLDS.tempWarnC) ||
        openServiceKinds.has("SERVICE_LATENCY") ||
        openServiceKinds.has("QUERY_DROUGHT");

      if (hasCritical) critical++;
      else if (hasWarning) warning++;
      else healthy++;

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
        service: (() => {
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
        })(),
      });
    }

    // Last devops-monitor worker run (proof of life for the board header).
    const workerRow = await db.workerStatus.findFirst({
      where: { workerName: "devops-monitor" },
      orderBy: { createdAt: "desc" },
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
      },
      miners,
      openEvents: events.open,
      recentEvents: events.recent,
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
