import { db } from "@/lib/db";
import { getUidState } from "./metagraph";
import { getDaemonView } from "./daemon-bridge";
import { commitFinding, autoResolve } from "./triggers-core";

/**
 * DEVOPS-1 — the always-on DevOps monitor pass.
 *
 * Runs on a schedule (workers.ts, every 90s) AND on-demand via
 * POST /api/triggers { action: "run" }. For every STARTED deployment it:
 *
 *   1. Snapshots the latest daemon telemetry into GpuSample history
 *      (Phase 2) and evaluates GPU health (Phase 1):
 *        - daemon missing            → info  "install the daemon"
 *        - daemon silent ≥ 10 min    → warning "no telemetry"
 *        - miner process dead ×2     → critical, act = daemon restart
 *        - temp ≥ 85°C ×2            → critical thermal
 *        - temp ≥ 78°C ×2            → warning thermal
 *        - util < 30% ×3 (alive)     → warning idle GPU
 *   2. Diffs the subnet against the previous pass (SUBNET_DRIFT):
 *        - hyperparameter changes (tempo / immunityPeriod / maxAllowedUids)
 *        - metagraph capacity moves (registered UIDs)
 *        - economics regime shift (median rewarded incentive ±50%)
 *        - hotkey UID moved (deregistration churn)
 *
 * Everything flows through commitFinding()/autoResolve() — deduped open
 * events, evidence refreshed in place, recovery auto-resolves. Approval
 * gating and execution stay in the Trigger Engine (triggers.ts).
 *
 * Mock deployments are monitored but tagged: one "mock" GpuSample per pass
 * (so the board shows a heartbeat) and NO GPU/subnet alarms — a simulated
 * pod can't be genuinely hot, and a fake hotkey is not a chain entity.
 */

// ---------------------------------------------------------------------------
// Thresholds (single place — tune here, not in the evaluators)
// ---------------------------------------------------------------------------

export const DEVOPS_THRESHOLDS = {
  /** °C — sustained GPU temperature alarms. */
  tempWarnC: 78,
  tempCriticalC: 85,
  /** Consecutive passes a thermal condition must hold before alarming. */
  thermalPasses: 2,
  /** % — average GPU utilization below this (while the miner runs) is idle. */
  utilFloorPct: 30,
  /** Consecutive idle passes before the idle-GPU warning. */
  idleUtilPasses: 3,
  /** Consecutive dead-process passes before the critical restart event. */
  processDownPasses: 2,
  /** Daemon silence before "no telemetry" (matches daemon-bridge unreachable). */
  daemonSilenceMs: 10 * 60_000,
  /** GpuSample rows kept per deployment (≈6h at 90s cadence). */
  sampleRetention: 240,
  /** Median rewarded incentive shift (relative) that counts as an economics regime change. */
  economicsShiftPct: 0.5,
} as const;

// ---------------------------------------------------------------------------
// Pass state — consecutive counters + drift baselines (in-memory, globalThis
// so dev hot-reload keeps one instance; evidence is persisted in the events)
// ---------------------------------------------------------------------------

interface DriftBaseline {
  tempo: number | null;
  immunityPeriod: number | null;
  maxAllowedUids: number | null;
  registeredUids: number;
  medianRewardedIncentive: number;
  uid: number | null;
  at: number;
}

interface DevopsPassState {
  hotPasses: Map<string, number>;
  coldUtilPasses: Map<string, number>;
  processDownPasses: Map<string, number>;
  silentPasses: Map<string, number>;
  driftBaselines: Map<string, DriftBaseline>;
  lastRunAt: number | null;
}

const globalForDevops = globalThis as unknown as {
  __infranexDevopsPass: DevopsPassState | undefined;
};

const passState: DevopsPassState =
  globalForDevops.__infranexDevopsPass ??
  (globalForDevops.__infranexDevopsPass = {
    hotPasses: new Map(),
    coldUtilPasses: new Map(),
    processDownPasses: new Map(),
    silentPasses: new Map(),
    driftBaselines: new Map(),
    lastRunAt: null,
  });

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface DevopsPassResult {
  evaluatedAt: string;
  deploymentsEvaluated: number;
  samplesTaken: number;
  created: number;
  refreshed: number;
  resolved: number;
  findings: {
    deploymentId: string;
    kind: "GPU_HEALTH" | "SUBNET_DRIFT";
    action: string;
  }[];
}

const SS58_RE = /^5[1-9A-HJ-NP-Za-km-z]{47}$/;

// ---------------------------------------------------------------------------
// Telemetry parsing helpers
// ---------------------------------------------------------------------------

interface GpuReading {
  utilPct: number;
  memUsedMb: number;
  memTotalMb: number;
  tempC: number;
}

function parseTelemetry(raw: unknown): {
  gpus: GpuReading[];
  processAlive: boolean | null;
  ageMs: number | null;
} {
  if (!raw || typeof raw !== "object") return { gpus: [], processAlive: null, ageMs: null };
  const t = raw as Record<string, unknown>;
  const gpusRaw = Array.isArray(t.gpus) ? t.gpus : [];
  const gpus: GpuReading[] = [];
  for (const g of gpusRaw) {
    if (!g || typeof g !== "object") continue;
    const o = g as Record<string, unknown>;
    gpus.push({
      utilPct: num(o.utilPct) ?? 0,
      memUsedMb: num(o.memUsedMb) ?? 0,
      memTotalMb: num(o.memTotalMb) ?? 0,
      tempC: num(o.tempC) ?? 0,
    });
  }
  const ts = num(t.ts);
  return {
    gpus,
    processAlive: typeof t.minerProcessAlive === "boolean" ? t.minerProcessAlive : null,
    ageMs: ts !== null ? Math.max(0, Date.now() - ts * 1000) : null,
  };
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Aggregate every GPU on the pod: max temp (hottest card), mean util/mem. */
function aggregateGpus(gpus: GpuReading[]): {
  maxTempC: number | null;
  meanUtilPct: number | null;
  memUsedMb: number | null;
  memTotalMb: number | null;
} {
  if (gpus.length === 0) return { maxTempC: null, meanUtilPct: null, memUsedMb: null, memTotalMb: null };
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    maxTempC: Math.max(...gpus.map((g) => g.tempC)),
    meanUtilPct: mean(gpus.map((g) => g.utilPct)),
    memUsedMb: mean(gpus.map((g) => g.memUsedMb)),
    memTotalMb: mean(gpus.map((g) => g.memTotalMb)),
  };
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

export async function runDevopsPass(): Promise<DevopsPassResult> {
  const deps = await db.deployment.findMany({ where: { status: "started" } });
  const result: DevopsPassResult = {
    evaluatedAt: new Date().toISOString(),
    deploymentsEvaluated: 0,
    samplesTaken: 0,
    created: 0,
    refreshed: 0,
    resolved: 0,
    findings: [],
  };

  for (const dep of deps) {
    result.deploymentsEvaluated++;

    // ---- Phase 2: sample + Phase 1: GPU health --------------------------
    const gpu = await evaluateGpuHealth(dep);
    result.samplesTaken += gpu.sampled ? 1 : 0;
    for (const f of gpu.findings) {
      if (f.action === "created") result.created++;
      else if (f.action === "refreshed") result.refreshed++;
      result.findings.push({ deploymentId: dep.id, kind: "GPU_HEALTH", action: f.action });
    }
    result.resolved += gpu.resolved;

    // ---- Phase 1: subnet drift ------------------------------------------
    const drift = await evaluateSubnetDrift(dep);
    for (const f of drift.findings) {
      if (f.action === "created") result.created++;
      else if (f.action === "refreshed") result.refreshed++;
      result.findings.push({ deploymentId: dep.id, kind: "SUBNET_DRIFT", action: f.action });
    }
    result.resolved += drift.resolved;
  }

  passState.lastRunAt = Date.now();
  return result;
}

// ---------------------------------------------------------------------------
// GPU health evaluator + GpuSample persistence
// ---------------------------------------------------------------------------

async function evaluateGpuHealth(dep: {
  id: string;
  minerName: string;
  netuid: number;
  subnetName: string;
  mode: string;
}): Promise<{ sampled: boolean; resolved: number; findings: { action: string }[] }> {
  const findings: { action: string }[] = [];
  let resolved = 0;
  const isMock = dep.mode === "mock";

  // Mock pods: heartbeat sample only — no real GPU can be hot or dead.
  if (isMock) {
    await writeSample(dep.id, "mock", null, null, null, null, null);
    // Clear anything stale from before a switch to mock.
    resolved += await clearGpuAlarms(dep.id, ["no-daemon", "silent", "proc", "temp", "util"]);
    return { sampled: true, resolved, findings };
  }

  const view = await getDaemonView(dep.id);

  // ---- No daemon registered at all → invite installation (info) ---------
  if (!view) {
    await writeSample(dep.id, "missing", null, null, null, null, null);
    const r = await commitFinding({
      kind: "GPU_HEALTH",
      severity: "info",
      dedupeKey: `${dep.id}:no-daemon`,
      title: `Install the node daemon on "${dep.minerName}"`,
      detail:
        "The deployment is running but no Node Daemon is registered, so GPU telemetry and one-click miner restarts are unavailable. Install it from the deployment's DevOps panel to unlock live GPU monitoring.",
      evidence: { reason: "no-daemon", suggestedAction: "none", checkedAt: new Date().toISOString() },
      deploymentId: dep.id,
      netuid: dep.netuid,
      runbook: [
        "Open the deployment in Deployments → DevOps section.",
        "Install the Node Daemon (one command, secret shown once).",
        "Telemetry starts flowing within 60s and this notice clears itself.",
      ],
    });
    findings.push({ action: r });
    resolved += await clearGpuAlarms(dep.id, ["silent", "proc", "temp", "util"]);
    return { sampled: true, resolved, findings };
  }

  const tele = parseTelemetry(view.telemetry);
  const agg = aggregateGpus(tele.gpus);

  // ---- Persist the sample (Phase 2) -------------------------------------
  await writeSample(
    dep.id,
    view.status,
    agg.meanUtilPct,
    agg.memUsedMb,
    agg.memTotalMb,
    agg.maxTempC,
    tele.processAlive
  );

  // ---- Daemon silent ≥ 10 min ------------------------------------------
  const silenceMs =
    view.lastSeenAt !== null ? Date.now() - new Date(view.lastSeenAt).getTime() : null;
  const silent = view.status === "unreachable" || (silenceMs !== null && silenceMs > DEVOPS_THRESHOLDS.daemonSilenceMs);

  if (silent) {
    const streak = (passState.silentPasses.get(dep.id) ?? 0) + 1;
    passState.silentPasses.set(dep.id, streak);
    if (streak >= 1) {
      const r = await commitFinding({
        kind: "GPU_HEALTH",
        severity: "warning",
        dedupeKey: `${dep.id}:silent`,
        title: `No telemetry from "${dep.minerName}" for ${Math.round((silenceMs ?? DEVOPS_THRESHOLDS.daemonSilenceMs) / 60_000)} min`,
        detail:
          "The node daemon stopped reporting (no telemetry beyond the 10-minute window). Either the host is down, the network path is broken, or the daemon agent died. GPU condition is UNKNOWN — treat like a blind miner.",
        evidence: {
          reason: "daemon-silent",
          suggestedAction: "none",
          silenceMinutes: silenceMs !== null ? Math.round(silenceMs / 60_000) : null,
          daemonStatus: view.status,
          lastSeenAt: view.lastSeenAt,
          checkedAt: new Date().toISOString(),
        },
        deploymentId: dep.id,
        netuid: dep.netuid,
        runbook: [
          "Check the pod status in the provider console (is the machine up?).",
          "If the machine is up, restart the daemon agent on the host.",
          "Approve to queue a status probe / restart via the daemon once it re-connects.",
        ],
      });
      findings.push({ action: r });
    }
  } else {
    if (passState.silentPasses.get(dep.id)) {
      passState.silentPasses.delete(dep.id);
      resolved += await autoResolve("GPU_HEALTH", `${dep.id}:silent`);
    }
  }

  // With no fresh telemetry we can't judge thermals/util/process — stop here.
  if (!tele.gpus.length && tele.processAlive === null) {
    return { sampled: true, resolved, findings };
  }

  // ---- Miner process dead (fresh telemetry says so) ----------------------
  if (tele.processAlive === false) {
    const streak = (passState.processDownPasses.get(dep.id) ?? 0) + 1;
    passState.processDownPasses.set(dep.id, streak);
    if (streak >= DEVOPS_THRESHOLDS.processDownPasses) {
      const r = await commitFinding({
        kind: "GPU_HEALTH",
        severity: "critical",
        dedupeKey: `${dep.id}:proc`,
        title: `Miner process DOWN on "${dep.minerName}" (${streak} passes)`,
        detail: `The daemon reports the miner process is not running for ${streak} consecutive passes while the pod is reachable. The machine is up but earning nothing — approval queues a daemon restart.`,
        evidence: {
          reason: "process-down",
          suggestedAction: "restart",
          downPasses: streak,
          gpu: agg,
          checkedAt: new Date().toISOString(),
        },
        deploymentId: dep.id,
        netuid: dep.netuid,
        runbook: [
          "Check the miner log on the host (/var/log/infranex-miner.log) for the crash cause.",
          "Approve to queue restart_miner via the daemon (executes within 60s).",
          "If it crash-loops after restart, inspect the subnet requirements for a config drift.",
        ],
      });
      findings.push({ action: r });
    }
  } else if (tele.processAlive === true) {
    if (passState.processDownPasses.get(dep.id)) {
      passState.processDownPasses.delete(dep.id);
      resolved += await autoResolve("GPU_HEALTH", `${dep.id}:proc`);
    }
  }

  // ---- Thermal (only meaningful when we have GPU readings) ---------------
  if (agg.maxTempC !== null) {
    const tempKey = passState.hotPasses.get(dep.id);
    if (agg.maxTempC >= DEVOPS_THRESHOLDS.tempCriticalC) {
      const streak = (tempKey ?? 0) + 1;
      passState.hotPasses.set(dep.id, streak);
      if (streak >= DEVOPS_THRESHOLDS.thermalPasses) {
        const r = await commitFinding({
          kind: "GPU_HEALTH",
          severity: "critical",
          dedupeKey: `${dep.id}:temp`,
          title: `GPU thermal CRITICAL on "${dep.minerName}" — ${agg.maxTempC.toFixed(0)}°C`,
          detail: `Hottest GPU is at ${agg.maxTempC.toFixed(0)}°C for ${streak} consecutive passes (threshold ${DEVOPS_THRESHOLDS.tempCriticalC}°C). Sustained temperatures here throttle clocks and risk hardware damage / provider bans.`,
          evidence: {
            reason: "thermal-critical",
            suggestedAction: "none",
            maxTempC: agg.maxTempC,
            thresholdC: DEVOPS_THRESHOLDS.tempCriticalC,
            hotPasses: streak,
            gpu: agg,
            checkedAt: new Date().toISOString(),
          },
          deploymentId: dep.id,
          netuid: dep.netuid,
          runbook: [
            "Verify pod cooling / fan curves in the provider console.",
            "Consider throttling the miner workload or moving to a cooler machine.",
            "Approve to acknowledge once temperatures are back under control.",
          ],
        });
        findings.push({ action: r });
      }
    } else if (agg.maxTempC >= DEVOPS_THRESHOLDS.tempWarnC) {
      const streak = (tempKey ?? 0) + 1;
      passState.hotPasses.set(dep.id, streak);
      if (streak >= DEVOPS_THRESHOLDS.thermalPasses) {
        const r = await commitFinding({
          kind: "GPU_HEALTH",
          severity: "warning",
          dedupeKey: `${dep.id}:temp`,
          title: `GPU running hot on "${dep.minerName}" — ${agg.maxTempC.toFixed(0)}°C`,
          detail: `Hottest GPU is at ${agg.maxTempC.toFixed(0)}°C for ${streak} consecutive passes (warn ${DEVOPS_THRESHOLDS.tempWarnC}°C, critical ${DEVOPS_THRESHOLDS.tempCriticalC}°C). Watch for a continued climb; thermal throttling may already be reducing throughput.`,
          evidence: {
            reason: "thermal-warn",
            suggestedAction: "none",
            maxTempC: agg.maxTempC,
            warnC: DEVOPS_THRESHOLDS.tempWarnC,
            criticalC: DEVOPS_THRESHOLDS.tempCriticalC,
            hotPasses: streak,
            gpu: agg,
            checkedAt: new Date().toISOString(),
          },
          deploymentId: dep.id,
          netuid: dep.netuid,
          runbook: [
            "Check airflow / ambient temperature on the host.",
            "Watch the temperature trend on the DevOps board.",
            "Approve to acknowledge once it drops back below the warn line.",
          ],
        });
        findings.push({ action: r });
      }
    } else if (tempKey) {
      passState.hotPasses.delete(dep.id);
      resolved += await autoResolve("GPU_HEALTH", `${dep.id}:temp`);
    }
  }

  // ---- Idle GPU (utilization low while the miner is alive) ---------------
  if (agg.meanUtilPct !== null && tele.processAlive !== false) {
    if (agg.meanUtilPct < DEVOPS_THRESHOLDS.utilFloorPct) {
      const streak = (passState.coldUtilPasses.get(dep.id) ?? 0) + 1;
      passState.coldUtilPasses.set(dep.id, streak);
      if (streak >= DEVOPS_THRESHOLDS.idleUtilPasses) {
        const r = await commitFinding({
          kind: "GPU_HEALTH",
          severity: "warning",
          dedupeKey: `${dep.id}:util`,
          title: `GPU idle on "${dep.minerName}" — ${agg.meanUtilPct.toFixed(0)}% util for ${streak} passes`,
          detail: `Average GPU utilization is ${agg.meanUtilPct.toFixed(0)}% (floor ${DEVOPS_THRESHOLDS.utilFloorPct}%) while the miner process reports alive. You are paying for hardware that is not working — typical causes: validator rejections, wrong miner version, or a queue stall.`,
          evidence: {
            reason: "idle-gpu",
            suggestedAction: "none",
            meanUtilPct: agg.meanUtilPct,
            floorPct: DEVOPS_THRESHOLDS.utilFloorPct,
            idlePasses: streak,
            gpu: agg,
            checkedAt: new Date().toISOString(),
          },
          deploymentId: dep.id,
          netuid: dep.netuid,
          runbook: [
            "Check miner logs for validator rejections or errors.",
            "Confirm the subnet's requirements did not change (see Subnet Drift events).",
            "Approve to restart the miner if the logs point at a wedged process.",
          ],
        });
        findings.push({ action: r });
      }
    } else if (passState.coldUtilPasses.get(dep.id)) {
      passState.coldUtilPasses.delete(dep.id);
      resolved += await autoResolve("GPU_HEALTH", `${dep.id}:util`);
    }
  }

  return { sampled: true, resolved, findings };
}

async function writeSample(
  deploymentId: string,
  daemonStatus: string,
  utilPct: number | null,
  memUsedMb: number | null,
  memTotalMb: number | null,
  tempC: number | null,
  processAlive: boolean | null
): Promise<void> {
  await db.gpuSample.create({
    data: { deploymentId, daemonStatus, gpuUtilPct: utilPct, memUsedMb, memTotalMb, tempC, processAlive },
  });
  // Retention — keep the newest DEVOPS_THRESHOLDS.sampleRetention rows.
  const stale = await db.gpuSample.findMany({
    where: { deploymentId },
    orderBy: { createdAt: "desc" },
    skip: DEVOPS_THRESHOLDS.sampleRetention,
    select: { id: true },
  });
  if (stale.length > 0) {
    await db.gpuSample.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  }
}

/** Auto-resolve the given GPU_HEALTH dedupe keys for a deployment. */
async function clearGpuAlarms(deploymentId: string, suffixes: string[]): Promise<number> {
  let n = 0;
  for (const s of suffixes) {
    n += await autoResolve("GPU_HEALTH", `${deploymentId}:${s}`);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Subnet drift evaluator — "if any changes happens in subnets, check and
// recommend for changes"
// ---------------------------------------------------------------------------

async function evaluateSubnetDrift(dep: {
  id: string;
  minerName: string;
  netuid: number;
  subnetName: string;
  hotkey: string | null;
}): Promise<{ resolved: number; findings: { action: string }[] }> {
  const findings: { action: string }[] = [];
  const dedupeKey = `${dep.id}:subnet-drift`;

  // A fake/mock hotkey is not a chain entity — keep a quiet baseline reset.
  if (!dep.hotkey || !SS58_RE.test(dep.hotkey)) {
    passState.driftBaselines.delete(dep.id);
    return { resolved: await autoResolveIfOpen(dedupeKey), findings };
  }

  let state: Awaited<ReturnType<typeof getUidState>>;
  try {
    state = await getUidState(dep.netuid, dep.hotkey);
  } catch {
    // Chain trouble — skip silently (never a false alarm).
    return { resolved: 0, findings };
  }

  const baseline = passState.driftBaselines.get(dep.id);
  const now: DriftBaseline = {
    tempo: state.hyperparams.tempo,
    immunityPeriod: state.hyperparams.immunityPeriod,
    maxAllowedUids: state.hyperparams.maxAllowedUids,
    registeredUids: state.cohort.registeredUids,
    medianRewardedIncentive: state.cohort.medianRewardedIncentive,
    uid: state.uid,
    at: Date.now(),
  };

  // First pass after boot: establish the baseline, resolve stale events.
  if (!baseline) {
    passState.driftBaselines.set(dep.id, now);
    return { resolved: await autoResolveIfOpen(dedupeKey), findings };
  }

  const changes: string[] = [];

  if (now.tempo !== null && baseline.tempo !== null && now.tempo !== baseline.tempo) {
    changes.push(`tempo ${baseline.tempo} → ${now.tempo}`);
  }
  if (
    now.immunityPeriod !== null &&
    baseline.immunityPeriod !== null &&
    now.immunityPeriod !== baseline.immunityPeriod
  ) {
    changes.push(`immunityPeriod ${baseline.immunityPeriod} → ${now.immunityPeriod} blocks`);
  }
  if (
    now.maxAllowedUids !== null &&
    baseline.maxAllowedUids !== null &&
    now.maxAllowedUids !== baseline.maxAllowedUids
  ) {
    changes.push(`maxAllowedUids ${baseline.maxAllowedUids} → ${now.maxAllowedUids}`);
  }
  if (now.registeredUids !== baseline.registeredUids) {
    const delta = now.registeredUids - baseline.registeredUids;
    changes.push(
      `metagraph capacity ${baseline.registeredUids} → ${now.registeredUids} UIDs (${delta > 0 ? "+" : ""}${delta})`
    );
  }
  if (
    baseline.medianRewardedIncentive > 0 &&
    Math.abs(now.medianRewardedIncentive - baseline.medianRewardedIncentive) /
      baseline.medianRewardedIncentive >
      DEVOPS_THRESHOLDS.economicsShiftPct
  ) {
    const dir = now.medianRewardedIncentive > baseline.medianRewardedIncentive ? "up" : "down";
    changes.push(
      `subnet economics shifted ${dir}: median rewarded incentive ${(baseline.medianRewardedIncentive * 100).toFixed(2)}% → ${(now.medianRewardedIncentive * 100).toFixed(2)}%`
    );
  }
  if (now.uid !== null && baseline.uid !== null && now.uid !== baseline.uid) {
    changes.push(`your UID moved ${baseline.uid} → ${now.uid} (deregistration/re-registration churn)`);
  }

  if (changes.length > 0) {
    const hyper = changes.some((c) =>
      ["tempo", "immunityPeriod", "maxAllowedUids"].some((k) => c.startsWith(k))
    );
    const r = await commitFinding({
      kind: "SUBNET_DRIFT",
      severity: hyper ? "warning" : "info",
      dedupeKey,
      title: `α${dep.netuid} ${dep.subnetName} changed for "${dep.minerName}"`,
      detail: `${changes.length} change${changes.length > 1 ? "s" : ""} detected since the last pass: ${changes.join("; ")}. ${
        hyper
          ? "Hyperparameter changes alter the subnet's operating rules — verify the miner still validates within them."
          : "Review whether the miner still fits this subnet's economics; the Optimization Engine can rank alternatives."
      }`,
      evidence: {
        netuid: dep.netuid,
        changes,
        before: {
          tempo: baseline.tempo,
          immunityPeriod: baseline.immunityPeriod,
          maxAllowedUids: baseline.maxAllowedUids,
          registeredUids: baseline.registeredUids,
          medianRewardedIncentive: baseline.medianRewardedIncentive,
          uid: baseline.uid,
        },
        after: {
          tempo: now.tempo,
          immunityPeriod: now.immunityPeriod,
          maxAllowedUids: now.maxAllowedUids,
          registeredUids: now.registeredUids,
          medianRewardedIncentive: now.medianRewardedIncentive,
          uid: now.uid,
        },
        sampledAt: new Date().toISOString(),
      },
      deploymentId: dep.id,
      netuid: dep.netuid,
      runbook: [
        "Open Subnets to inspect the subnet's current state and requirements.",
        "Check miner logs — hyperparameter changes may need a miner restart or update.",
        "If economics moved against you, run the Optimization Engine for cheaper/better fits.",
        "Approve to acknowledge once reviewed (the event re-opens on new changes).",
      ],
    });
    findings.push({ action: r });
  } else {
    // No drift — resolve any stale drift event.
    passState.driftBaselines.set(dep.id, now);
    return { resolved: await autoResolveIfOpen(dedupeKey), findings };
  }

  passState.driftBaselines.set(dep.id, now);
  return { resolved: 0, findings };
}

async function autoResolveIfOpen(dedupeKey: string): Promise<number> {
  return autoResolve("SUBNET_DRIFT", dedupeKey);
}
