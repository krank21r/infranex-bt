/**
 * TIER1-1 — Miner Health Score (spec §22 "Miner Health Model").
 *
 * One composite 0–100 number per running miner, built ONLY from signals the
 * platform already collects every 90s pass:
 *
 *   process   (25)  daemon-reported miner process state
 *   daemon    (15)  telemetry freshness (silent daemon = blind ops)
 *   service   (20)  synthetic axon probe: dead endpoint / latency / success rate
 *   thermal   (15)  hottest GPU vs warn/critical lines
 *   workload  (10)  GPU utilization vs the idle floor
 *   traffic   (10)  validator query volume vs its own baseline (drought)
 *   chain     (5)   UID risk (deregistration signals)
 *
 * Design rules:
 *   - UNKNOWN never equals BAD. Missing telemetry scores mid-range, never 0,
 *     so a paused daemon degrades the score instead of faking a crash.
 *   - Pure + dependency-injected: the evaluator and the tests call the same
 *     function with the same inputs, so the board and the engine agree.
 *   - Mock deployments are FORCED healthy (simulated fleet can't be sick);
 *     the card shows the score with its "mock" tag anyway.
 */

// ---------------------------------------------------------------------------
// Thresholds — single place to tune (mirrors the other engine threshold blocks)
// ---------------------------------------------------------------------------

export const HEALTH_THRESHOLDS = {
  /** Score at/above this = healthy. */
  healthyAt: 85,
  /** Score at/above this (below healthyAt) = warning; below = critical. */
  warningAt: 60,
  /** Probe success-rate below this (last 40 probes) starts costing points. */
  probeSuccessFloorPct: 95,
  /** Probe latency above this counts as slow (matches service-health slow line). */
  slowTotalMs: 8000,
} as const;

// ---------------------------------------------------------------------------
// Input shape — everything optional; null = unknown
// ---------------------------------------------------------------------------

export interface MinerHealthInput {
  isMock?: boolean;
  processAlive: boolean | null;
  /** Daemon silent ≥ 10 min (or no daemon at all when `hasDaemon` is false). */
  hasDaemon: boolean;
  daemonSilent: boolean;
  tempC: number | null;
  tempWarnC: number;
  tempCriticalC: number;
  utilPct: number | null;
  utilFloorPct: number;
  /** Latest probe verdict (null = never probed). */
  probeOk: boolean | null;
  probeTotalMs: number | null;
  probeSuccessRatePct: number | null;
  /** Validator traffic in the last window (null = unknown). */
  trafficRequests: number | null;
  /** Open QUERY_DROUGHT event for this miner. */
  queryDrought: boolean;
  /** UID risk level from the deregistration-defense evaluator. */
  uidRisk: "healthy" | "warning" | "critical" | null;
}

export interface HealthFactor {
  key: "process" | "daemon" | "service" | "thermal" | "workload" | "traffic" | "chain";
  label: string;
  score: number;
  max: number;
  detail: string;
}

export interface MinerHealth {
  score: number;
  status: "healthy" | "warning" | "critical";
  factors: HealthFactor[];
  simulated: boolean;
}

// ---------------------------------------------------------------------------
// The scorer
// ---------------------------------------------------------------------------

export function computeMinerHealth(input: MinerHealthInput): MinerHealth {
  if (input.isMock) {
    return {
      score: 96,
      status: "healthy",
      simulated: true,
      factors: [
        { key: "process", label: "Process", score: 25, max: 25, detail: "simulated miner" },
        { key: "daemon", label: "Daemon", score: 15, max: 15, detail: "simulated telemetry" },
        { key: "service", label: "Service", score: 20, max: 20, detail: "simulated probe" },
        { key: "thermal", label: "Thermal", score: 15, max: 15, detail: "simulated GPU" },
        { key: "workload", label: "Workload", score: 10, max: 10, detail: "simulated utilization" },
        { key: "traffic", label: "Traffic", score: 10, max: 10, detail: "simulated queries" },
        { key: "chain", label: "Chain", score: 5, max: 5, detail: "no real UID" },
      ],
    };
  }

  const factors: HealthFactor[] = [];

  // A silent daemon means we can't actually see the process either — never
  // credit a stale "alive" reading across a telemetry blackout.
  const processAlive = input.daemonSilent ? null : input.processAlive;

  // ---- process (25) -------------------------------------------------------
  if (processAlive === true) {
    factors.push({ key: "process", label: "Process", score: 25, max: 25, detail: "miner running" });
  } else if (processAlive === false) {
    factors.push({ key: "process", label: "Process", score: 0, max: 25, detail: "miner process DOWN" });
  } else {
    factors.push({ key: "process", label: "Process", score: 15, max: 25, detail: "unknown (no fresh telemetry)" });
  }

  // ---- daemon (15) --------------------------------------------------------
  if (!input.hasDaemon) {
    factors.push({ key: "daemon", label: "Daemon", score: 8, max: 15, detail: "not installed" });
  } else if (input.daemonSilent) {
    factors.push({ key: "daemon", label: "Daemon", score: 0, max: 15, detail: "no telemetry for 10+ min — blind" });
  } else {
    factors.push({ key: "daemon", label: "Daemon", score: 15, max: 15, detail: "telemetry fresh" });
  }

  // ---- service (20) -------------------------------------------------------
  if (input.probeOk === true) {
    const slow = input.probeTotalMs != null && input.probeTotalMs > HEALTH_THRESHOLDS.slowTotalMs;
    const weakRate =
      input.probeSuccessRatePct != null && input.probeSuccessRatePct < HEALTH_THRESHOLDS.probeSuccessFloorPct;
    const score = slow ? 12 : weakRate ? 14 : 20;
    const bits = [
      `alive${input.probeTotalMs != null ? ` · ${Math.round(input.probeTotalMs)}ms` : ""}`,
      weakRate ? `success ${input.probeSuccessRatePct}%` : null,
      slow ? "slow" : null,
    ].filter(Boolean);
    factors.push({ key: "service", label: "Service", score, max: 20, detail: bits.join(" · ") });
  } else if (input.probeOk === false) {
    factors.push({ key: "service", label: "Service", score: 0, max: 20, detail: "axon endpoint DEAD" });
  } else {
    factors.push({ key: "service", label: "Service", score: 13, max: 20, detail: "never probed" });
  }

  // ---- thermal (15) -------------------------------------------------------
  if (input.tempC == null) {
    factors.push({ key: "thermal", label: "Thermal", score: 10, max: 15, detail: "no GPU reading" });
  } else if (input.tempC >= input.tempCriticalC) {
    factors.push({ key: "thermal", label: "Thermal", score: 0, max: 15, detail: `${input.tempC.toFixed(0)}°C ≥ critical ${input.tempCriticalC}°C` });
  } else if (input.tempC >= input.tempWarnC) {
    factors.push({ key: "thermal", label: "Thermal", score: 7, max: 15, detail: `${input.tempC.toFixed(0)}°C ≥ warn ${input.tempWarnC}°C` });
  } else {
    factors.push({ key: "thermal", label: "Thermal", score: 15, max: 15, detail: `${input.tempC.toFixed(0)}°C nominal` });
  }

  // ---- workload (10) ------------------------------------------------------
  if (input.utilPct == null) {
    factors.push({ key: "workload", label: "Workload", score: 6, max: 10, detail: "no utilization reading" });
  } else if (input.utilPct < input.utilFloorPct) {
    factors.push({ key: "workload", label: "Workload", score: 2, max: 10, detail: `idle — ${input.utilPct.toFixed(0)}% < floor ${input.utilFloorPct}%` });
  } else {
    factors.push({ key: "workload", label: "Workload", score: 10, max: 10, detail: `${input.utilPct.toFixed(0)}% utilized` });
  }

  // ---- traffic (10) -------------------------------------------------------
  if (input.queryDrought) {
    factors.push({ key: "traffic", label: "Traffic", score: 3, max: 10, detail: "query drought — validators pulling back" });
  } else if (input.trafficRequests == null) {
    factors.push({ key: "traffic", label: "Traffic", score: 6, max: 10, detail: "no parsable query log" });
  } else {
    factors.push({ key: "traffic", label: "Traffic", score: 10, max: 10, detail: `${input.trafficRequests} queries last hour` });
  }

  // ---- chain (5) ----------------------------------------------------------
  if (input.uidRisk === "critical") {
    factors.push({ key: "chain", label: "Chain", score: 0, max: 5, detail: "UID at critical risk" });
  } else if (input.uidRisk === "warning") {
    factors.push({ key: "chain", label: "Chain", score: 2, max: 5, detail: "UID showing warning signals" });
  } else if (input.uidRisk === "healthy") {
    factors.push({ key: "chain", label: "Chain", score: 5, max: 5, detail: "UID healthy" });
  } else {
    factors.push({ key: "chain", label: "Chain", score: 4, max: 5, detail: "no UID snapshot" });
  }

  const score = factors.reduce((a, f) => a + f.score, 0);

  // Hard-fail — the conditions the engine itself treats as critical (process
  // down, dead axon, thermal emergency) force the critical status even when
  // the weighted score would still land in the warning band.
  const hardFail =
    processAlive === false ||
    input.probeOk === false ||
    (input.tempC != null && input.tempC >= input.tempCriticalC);

  const status: MinerHealth["status"] =
    hardFail || score < HEALTH_THRESHOLDS.warningAt
      ? "critical"
      : score < HEALTH_THRESHOLDS.healthyAt
        ? "warning"
        : "healthy";

  return { score, status, factors, simulated: false };
}
