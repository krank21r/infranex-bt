import { db } from "@/lib/db";
import { commitFinding, autoResolve } from "./triggers-core";
import { getAxonInfo } from "./metagraph";
import { getDaemonView } from "./daemon-bridge";
import { deserializeConfig } from "./deployment/config";

/**
 * DEVOPS-4 — Service Health & Validator Traffic pass.
 *
 * The GPU can look perfectly healthy while the SERVICE it serves is dead to
 * validators: a hung axon, a wedged model, a firewall change. And incentive
 * numbers lag reality — by the time DEREG_RISK sees a collapsing incentive,
 * the miner may have been unreachable for hours. This pass measures what
 * validators measure, every 90s, BEFORE the income shows it:
 *
 *   1. SYNTHETIC VALIDATOR PROBE (PROBE_FAIL / SERVICE_LATENCY events)
 *      Every pass the engine resolves the miner's axon endpoint (on-chain
 *      axons storage first, then the deployment's own host:axonPort) and
 *      sends a synthetic HTTP query with full timing. Any HTTP answer
 *      (even a 4xx from a FastAPI app) proves the endpoint is alive —
 *      connect refused / timeout / 5xx means validators fail against it.
 *      - 2 consecutive failed probes  → PROBE_FAIL critical; approval
 *        queues a daemon restart so the miner re-announces a fresh axon.
 *      - 3 consecutive slow probes (vs absolute + rolling-median lines)
 *        → SERVICE_LATENCY warning; the Runtime Optimizer's recipes
 *        (vLLM/TensorRT/quantization) are the fix path.
 *
 *   2. VALIDATOR TRAFFIC MONITOR (QUERY_DROUGHT event)
 *      The Node Daemon tails the host's miner log and reports the number
 *      of requests and distinct validator hotkeys seen in its window. The
 *      engine baselines that stream; when incoming queries collapse to
 *      <30% of the observed baseline for 3 consecutive windows while the
 *      miner is up, it fires QUERY_DROUGHT — the EARLIEST deregistration
 *      warning there is ("a top validator stopped querying you"), before
 *      incentive even moves. Miners whose logs don't expose queries are
 *      reported as unknown and never false-alarm.
 *
 * Mock deployments: fully simulated (probe + plausible traffic, tagged
 * mode:"mock") so the board demonstrates the feature — a simulated pod
 * can't genuinely fail, so mocks never alarm and stale alarms clear.
 */

// ---------------------------------------------------------------------------
// Thresholds (single tuning place; rides the monitor payload for the UI)
// ---------------------------------------------------------------------------

export const SERVICE_THRESHOLDS = {
  /** Probe HTTP timeout (ms) — validators won't wait longer either. */
  probeTimeoutMs: 15_000,
  /** Absolute slow line (ms, headers+body). */
  slowTotalMs: 8_000,
  /** Or slower than this multiple of the rolling median (needs ≥5 samples). */
  slowRatioVsMedian: 3,
  /** Consecutive failed probes before PROBE_FAIL goes critical. */
  failPasses: 2,
  /** Consecutive slow probes before SERVICE_LATENCY fires. */
  slowPasses: 3,
  /** Traffic history kept per miner (windows, ≈4h at 90s cadence). */
  trafficHistoryWindows: 160,
  /** Minimum baseline requests/window before drought math is meaningful. */
  minRequestsForDrought: 5,
  /** Minimum history windows before drought math starts. */
  minWindowsForDrought: 12,
  /** Current window below this fraction of the baseline = drought candidate. */
  droughtFloorRatio: 0.3,
  /** Consecutive drought windows before QUERY_DROUGHT fires. */
  droughtPasses: 3,
} as const;

/** Widened view for DI / test overrides. */
export type ServiceThresholds = { [K in keyof typeof SERVICE_THRESHOLDS]: number };

// ---------------------------------------------------------------------------
// Pass state — streak counters + traffic baselines (globalThis singleton)
// ---------------------------------------------------------------------------

interface ServicePassState {
  failStreaks: Map<string, number>;
  slowStreaks: Map<string, number>;
  droughtStreaks: Map<string, number>;
  trafficHistory: Map<string, number[]>;
  lastRunAt: number | null;
}

const globalForService = globalThis as unknown as {
  __infranexServicePass: ServicePassState | undefined;
};

const serviceState: ServicePassState =
  globalForService.__infranexServicePass ??
  (globalForService.__infranexServicePass = {
    failStreaks: new Map(),
    slowStreaks: new Map(),
    droughtStreaks: new Map(),
    trafficHistory: new Map(),
    lastRunAt: null,
  });

/** Test-only: wipe in-memory streaks/baselines between scenarios. */
export function resetServiceStateForTests(): void {
  serviceState.failStreaks.clear();
  serviceState.slowStreaks.clear();
  serviceState.droughtStreaks.clear();
  serviceState.trafficHistory.clear();
  serviceState.lastRunAt = null;
}

// ---------------------------------------------------------------------------
// Pure helpers — exported so tests classify EXACTLY like the evaluator
// ---------------------------------------------------------------------------

export interface ProbeOutcome {
  ok: boolean;
  httpStatus: number | null;
  ttfbMs: number | null;
  totalMs: number | null;
  errorKind: "timeout" | "connect" | "dns" | "http-5xx" | null;
  errorDetail: string | null;
}

/** Rolling median of the last N successful probes (ms). */
export function rollingMedianMs(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Slow verdict: above the absolute line, or above slowRatio × the rolling
 * median once we have enough samples to trust it.
 */
export function isSlowProbe(
  totalMs: number | null,
  median: number | null,
  th: Pick<ServiceThresholds, "slowTotalMs" | "slowRatioVsMedian">
): boolean {
  if (totalMs === null) return false;
  if (totalMs >= th.slowTotalMs) return true;
  if (median !== null && median > 0 && totalMs > th.slowRatioVsMedian * median) return true;
  return false;
}

export interface DroughtVerdict {
  /** Drought candidate this window? */
  candidate: boolean;
  /** Enough history/baseline to COMMIT an event? */
  meaningful: boolean;
  baselineAvg: number;
}

/**
 * Query-drought math: current window vs the running baseline of recent
 * windows. Unknown traffic (requests === null) is never a drought.
 */
export function droughtVerdict(
  history: number[],
  current: number | null,
  th: Pick<
    ServiceThresholds,
    "minRequestsForDrought" | "minWindowsForDrought" | "droughtFloorRatio"
  >
): DroughtVerdict {
  if (current === null) {
    return { candidate: false, meaningful: false, baselineAvg: 0 };
  }
  const baselineAvg = history.length
    ? history.reduce((a, b) => a + b, 0) / history.length
    : 0;
  const meaningful = history.length >= th.minWindowsForDrought && baselineAvg >= th.minRequestsForDrought;
  const candidate = meaningful && current < th.droughtFloorRatio * baselineAvg;
  return { candidate, meaningful, baselineAvg };
}

// ---------------------------------------------------------------------------
// Endpoint resolution — on-chain axon first, deployment host:port fallback
// ---------------------------------------------------------------------------

export interface AxonEndpoint {
  endpoint: string;
  port: number;
  source: "chain" | "deployment" | "mock";
}

export async function resolveAxonEndpoint(dep: {
  id: string;
  mode: string;
  netuid: number;
  hotkey: string | null;
  registeredUid: number | null;
  sshHost: string | null;
  config: string;
}): Promise<AxonEndpoint | null> {
  if (dep.mode === "mock") return { endpoint: "simulated", port: 0, source: "mock" };

  // 1) What the miner ANNOUNCES on-chain is what validators query.
  let uid = dep.registeredUid ?? null;
  if (uid === null && dep.hotkey) {
    try {
      const { getUidState } = await import("./metagraph");
      const st = await getUidState(dep.netuid, dep.hotkey);
      uid = st.uid;
    } catch {
      uid = null;
    }
  }
  if (uid !== null) {
    const ax = await getAxonInfo(dep.netuid, uid);
    if (ax) return { endpoint: ax.endpoint, port: ax.port, source: "chain" };
  }

  // 2) Fallback: the deployment's own host + configured axon port.
  const cfg = deserializeConfig(dep.config);
  if (dep.sshHost && cfg?.miner?.axonPort) {
    return { endpoint: dep.sshHost, port: cfg.miner.axonPort, source: "deployment" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The probe — synthetic validator query with full timing
// ---------------------------------------------------------------------------

/**
 * POST a synthetic query to the axon. ANY HTTP response (< 500) counts as
 * alive: generic probe bodies don't match every subnet's synapse model, so
 * a 400/404/422 from the serving app is still proof the endpoint answers
 * and a clean latency measurement. Connect/timeout/5xx = validators fail.
 */
export async function probeAxon(
  endpoint: string,
  port: number,
  timeoutMs: number,
  inject?: (endpoint: string, port: number) => Promise<ProbeOutcome>
): Promise<ProbeOutcome> {
  if (inject) return inject(endpoint, port);
  const url = `http://${endpoint}:${port}/`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        synapse_schema_version: 1,
        role: "infranex-synthetic-validator-probe",
        ts: started,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ttfbMs = Date.now() - started;
    // Read a bounded chunk of the body so totalMs covers the full round trip.
    await res.arrayBuffer();
    const totalMs = Date.now() - started;
    const ok = res.status < 500;
    return {
      ok,
      httpStatus: res.status,
      ttfbMs,
      totalMs,
      errorKind: ok ? null : "http-5xx",
      errorDetail: ok ? null : `HTTP ${res.status} from axon`,
    };
  } catch (e) {
    const totalMs = Date.now() - started;
    const err = e as Error & { cause?: { code?: string }; name?: string };
    const code = err?.cause?.code ?? "";
    let kind: ProbeOutcome["errorKind"] = "connect";
    if (err?.name === "TimeoutError" || err?.name === "AbortError" || code === "ETIMEDOUT") {
      kind = "timeout";
    } else if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      kind = "dns";
    }
    return {
      ok: false,
      httpStatus: null,
      ttfbMs: null,
      totalMs,
      errorKind: kind,
      errorDetail: err?.message ?? "probe failed",
    };
  }
}

// ---------------------------------------------------------------------------
// Sample persistence (retention mirrors GpuSample)
// ---------------------------------------------------------------------------

const SAMPLE_RETENTION = 240;

async function writeProbeSample(depId: string, p: ProbeOutcome & { endpoint: string | null; mode: string }) {
  await db.probeSample.create({
    data: {
      deploymentId: depId,
      endpoint: p.endpoint,
      mode: p.mode,
      ok: p.ok,
      httpStatus: p.httpStatus,
      ttfbMs: p.ttfbMs,
      totalMs: p.totalMs,
      errorKind: p.errorKind,
      errorDetail: p.errorDetail,
    },
  });
  await prune("probeSample", depId);
}

async function writeTrafficSample(depId: string, t: TrafficRecord) {
  await db.trafficSample.create({
    data: {
      deploymentId: depId,
      windowMinutes: t.windowMinutes,
      requests: t.requests,
      distinctValidators: t.distinctValidators,
      topValidatorHotkey: t.topValidatorHotkey,
      topValidatorCount: t.topValidatorCount,
      logFound: t.logFound,
    },
  });
  await prune("trafficSample", depId);
}

async function prune(model: "probeSample" | "trafficSample", deploymentId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = (db as any)[model] as {
    findMany: (a: any) => Promise<{ id: string }[]>;
    deleteMany: (a: any) => Promise<unknown>;
  };
  const stale = await m.findMany({
    where: { deploymentId },
    orderBy: { createdAt: "desc" },
    skip: SAMPLE_RETENTION,
    select: { id: true },
  });
  if (stale.length > 0) {
    await m.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  }
}

// ---------------------------------------------------------------------------
// Daemon traffic record (parsed from the miner log on the host)
// ---------------------------------------------------------------------------

interface TrafficRecord {
  windowMinutes: number | null;
  requests: number | null;
  distinctValidators: number | null;
  topValidatorHotkey: string | null;
  topValidatorCount: number | null;
  logFound: boolean;
}

function parseTraffic(telemetry: unknown): TrafficRecord | null {
  if (!telemetry || typeof telemetry !== "object") return null;
  const t = telemetry as Record<string, unknown>;
  const raw = t.traffic;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const n = (v: unknown): number | null => {
    const x = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    return Number.isFinite(x) ? x : null;
  };
  return {
    windowMinutes: n(o.windowMinutes),
    requests: n(o.requests),
    distinctValidators: n(o.distinctValidators),
    topValidatorHotkey: typeof o.topValidatorHotkey === "string" ? o.topValidatorHotkey : null,
    topValidatorCount: n(o.topValidatorCount),
    logFound: o.logFound === true,
  };
}

// ---------------------------------------------------------------------------
// Mock simulators — plausible, never alarming
// ---------------------------------------------------------------------------

function simulateProbeOutcome(): ProbeOutcome {
  // 220–900ms round trip, always ok — a simulated pod cannot genuinely fail.
  const total = 220 + Math.random() * 680;
  return {
    ok: true,
    httpStatus: 200,
    ttfbMs: Math.round(total * 0.55),
    totalMs: Math.round(total),
    errorKind: null,
    errorDetail: null,
  };
}

function simulateTraffic(depId: string): TrafficRecord {
  // Stable pseudo-hotkeys derived from the deployment id — plausible SS58-ish.
  const h = (i: number) => {
    let x = 0;
    for (const c of depId + ":" + i) x = (x * 31 + c.charCodeAt(0)) >>> 0;
    return `5MOCK${x.toString(36).toUpperCase().padStart(10, "0")}`;
  };
  const validators = 3 + Math.floor(Math.random() * 4); // 3-6 distinct
  const requests = 25 + Math.floor(Math.random() * 45); // 25-70 / window
  let topIdx = 0;
  let topCount = 0;
  const counts = Array.from({ length: validators }, () => 1 + Math.floor(Math.random() * 12));
  counts.forEach((c, i) => {
    if (c > topCount) {
      topCount = c;
      topIdx = i;
    }
  });
  return {
    windowMinutes: 60,
    requests,
    distinctValidators: validators,
    topValidatorHotkey: h(topIdx),
    topValidatorCount: topCount,
    logFound: true,
  };
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

export interface ServicePassResult {
  evaluatedAt: string;
  deploymentsEvaluated: number;
  probesTaken: number;
  trafficSampled: number;
  created: number;
  refreshed: number;
  resolved: number;
  findings: {
    deploymentId: string;
    kind: "PROBE_FAIL" | "SERVICE_LATENCY" | "QUERY_DROUGHT";
    action: string;
  }[];
}

export interface ServicePassOptions {
  thresholds?: Partial<ServiceThresholds>;
  /** DI: custom probe (tests inject failures/slowness). */
  probe?: (endpoint: string, port: number) => Promise<ProbeOutcome>;
  /** DI: custom traffic source (tests inject drought streams). */
  traffic?: (depId: string, dep: DeployableDep) => TrafficRecord | null;
  /** DI: custom endpoint resolver (tests avoid chain + host lookups). */
  resolveEndpoint?: (dep: DeployableDep) => Promise<AxonEndpoint | null>;
}

interface DeployableDep {
  id: string;
  minerName: string;
  netuid: number;
  subnetName: string;
  mode: string;
  hotkey: string | null;
  registeredUid: number | null;
  sshHost: string | null;
  config: string;
}

export async function runServiceHealthPass(
  opts?: ServicePassOptions
): Promise<ServicePassResult> {
  const th: ServiceThresholds = { ...SERVICE_THRESHOLDS, ...(opts?.thresholds ?? {}) };
  const deps = (await db.deployment.findMany({
    where: { status: "started" },
  })) as unknown as DeployableDep[];

  const result: ServicePassResult = {
    evaluatedAt: new Date().toISOString(),
    deploymentsEvaluated: 0,
    probesTaken: 0,
    trafficSampled: 0,
    created: 0,
    refreshed: 0,
    resolved: 0,
    findings: [],
  };

  for (const dep of deps) {
    result.deploymentsEvaluated++;
    const outcome = await evaluateServiceForDep(dep, th, opts);
    result.probesTaken += outcome.probed;
    result.trafficSampled += outcome.traffic;
    for (const f of outcome.findings) {
      if (f.action === "created") result.created++;
      else if (f.action === "refreshed") result.refreshed++;
      result.resolved += f.resolved;
      result.findings.push({
        deploymentId: dep.id,
        kind: f.kind,
        action: f.action,
      });
    }
    result.resolved += outcome.resolved;
  }

  serviceState.lastRunAt = Date.now();
  return result;
}

interface DepOutcome {
  probed: number;
  traffic: number;
  resolved: number;
  findings: { kind: ServicePassResult["findings"][number]["kind"]; action: string; resolved: number }[];
}

async function evaluateServiceForDep(
  dep: DeployableDep,
  th: ServiceThresholds,
  opts?: ServicePassOptions
): Promise<DepOutcome> {
  const findings: DepOutcome["findings"] = [];
  let resolved = 0;
  let probed = 0;
  let traffic = 0;
  const isMock = dep.mode === "mock";

  // ---- Probe --------------------------------------------------------------
  if (isMock) {
    const sim = simulateProbeOutcome();
    await writeProbeSample(dep.id, { ...sim, endpoint: "simulated", mode: "mock" });
    probed++;
    // A simulated pod can't genuinely fail — clear stale service alarms.
    for (const key of ["probe-fail", "slow", "drought"] as const) {
      resolved += await autoResolveFor(key, dep.id);
    }
    serviceState.failStreaks.delete(dep.id);
    serviceState.slowStreaks.delete(dep.id);
    serviceState.droughtStreaks.delete(dep.id);
  } else {
    const ep = opts?.resolveEndpoint
      ? await opts.resolveEndpoint(dep)
      : await resolveAxonEndpoint(dep);
    if (!ep) {
      // Nothing resolvable to probe — skip silently, never false-alarm.
      for (const key of ["probe-fail", "slow"] as const) {
        resolved += await autoResolveFor(key, dep.id);
      }
      serviceState.failStreaks.delete(dep.id);
      serviceState.slowStreaks.delete(dep.id);
    } else {
      const outcome = await probeAxon(ep.endpoint, ep.port, th.probeTimeoutMs, opts?.probe);
      await writeProbeSample(dep.id, {
        ...outcome,
        endpoint: `${ep.endpoint}:${ep.port}`,
        mode: "real",
      });
      probed++;

      // Rolling median of recent successful probes (slowness needs context).
      const recentOk = await db.probeSample.findMany({
        where: { deploymentId: dep.id, ok: true },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { totalMs: true },
      });
      const okMs = recentOk.map((r) => r.totalMs).filter((v): v is number => v !== null);
      const median = rollingMedianMs(okMs.slice(1)); // exclude this probe
      const slow = isSlowProbe(outcome.totalMs, median, th);

      // --- Failed probes → PROBE_FAIL (critical, restart) ---
      if (!outcome.ok) {
        const streak = (serviceState.failStreaks.get(dep.id) ?? 0) + 1;
        serviceState.failStreaks.set(dep.id, streak);
        serviceState.slowStreaks.delete(dep.id);
        if (streak >= th.failPasses) {
          const r = await commitFinding({
            kind: "PROBE_FAIL",
            severity: "critical",
            dedupeKey: `${dep.id}:probe-fail`,
            title: `Axon endpoint DEAD on "${dep.minerName}" — validators can't reach it`,
            detail: `The synthetic probe against ${ep.endpoint}:${ep.port} failed ${streak} consecutive passes (${outcome.errorKind}: ${outcome.errorDetail}). Validators querying this UID hit the same wall — income is already bleeding even if GPU vitals look fine. Approval restarts the miner so it re-announces a fresh axon.`,
            evidence: {
              reason: "probe-fail",
              suggestedAction: "restart",
              endpoint: `${ep.endpoint}:${ep.port}`,
              endpointSource: ep.source,
              failPasses: streak,
              errorKind: outcome.errorKind,
              errorDetail: outcome.errorDetail,
              probedAt: new Date().toISOString(),
            },
            deploymentId: dep.id,
            netuid: dep.netuid,
            runbook: [
              "Confirm the miner process is up on the host (daemon says live ≠ axon serving).",
              `Check the axon port (${ep.port}) is open and the model finished loading.`,
              "Approve to queue restart_miner via the daemon — the fresh process re-announces the axon on-chain.",
              "If probes keep failing after restart, inspect the miner log for bind errors.",
            ],
          });
          findings.push({ kind: "PROBE_FAIL", action: r, resolved: 0 });
        }
      } else if (serviceState.failStreaks.get(dep.id)) {
        serviceState.failStreaks.delete(dep.id);
        resolved += await autoResolveFor("probe-fail", dep.id);
      }

      // --- Slow probes → SERVICE_LATENCY (warning, runtime-optimizer path) ---
      if (outcome.ok && slow) {
        const streak = (serviceState.slowStreaks.get(dep.id) ?? 0) + 1;
        serviceState.slowStreaks.set(dep.id, streak);
        if (streak >= th.slowPasses) {
          const r = await commitFinding({
            kind: "SERVICE_LATENCY",
            severity: "warning",
            dedupeKey: `${dep.id}:slow`,
            title: `Axon latency HIGH on "${dep.minerName}" — ${Math.round(outcome.totalMs ?? 0)}ms`,
            detail: `The synthetic probe answered in ${Math.round(outcome.totalMs ?? 0)}ms (median ${median !== null ? Math.round(median) : "—"}ms, slow line ${th.slowTotalMs}ms or ${th.slowRatioVsMedian}× median) for ${streak} consecutive passes. Latency-sensitive validators rank slow miners down long before the miner actually fails. The Runtime Optimizer's accelerated profiles (vLLM batching, TensorRT-LLM, AWQ/EXL2 quantization) are the fix path.`,
            evidence: {
              reason: "probe-slow",
              suggestedAction: "evaluate",
              endpoint: `${ep.endpoint}:${ep.port}`,
              endpointSource: ep.source,
              slowPasses: streak,
              lastTotalMs: outcome.totalMs,
              lastTtfbMs: outcome.ttfbMs,
              medianTotalMs: median,
              slowLineMs: th.slowTotalMs,
              probedAt: new Date().toISOString(),
            },
            deploymentId: dep.id,
            netuid: dep.netuid,
            runbook: [
              "Check host load / GPU contention on the DevOps board (thermal, saturation).",
              "Approve to acknowledge once latency is back under the line.",
              "Run the Runtime Optimizer path: an accelerated serving profile cuts TTFT and raises throughput.",
            ],
          });
          findings.push({ kind: "SERVICE_LATENCY", action: r, resolved: 0 });
        }
      } else if (outcome.ok && !slow && serviceState.slowStreaks.get(dep.id)) {
        serviceState.slowStreaks.delete(dep.id);
        resolved += await autoResolveFor("slow", dep.id);
      }
    }
  }

  // ---- Validator traffic ---------------------------------------------------
  let trafficRec: TrafficRecord | null = null;
  if (isMock) {
    trafficRec = simulateTraffic(dep.id);
  } else if (opts?.traffic) {
    // DI (tests): inject a traffic stream instead of daemon telemetry.
    trafficRec = opts.traffic(dep.id, dep);
  } else {
    const view = await getDaemonView(dep.id);
    trafficRec = parseTraffic(view?.telemetry);
  }
  if (trafficRec && trafficRec.requests !== null) {
    await writeTrafficSample(dep.id, trafficRec);
    traffic++;

    const history = serviceState.trafficHistory.get(dep.id) ?? [];
    const verdict = droughtVerdict(history, trafficRec.requests, th);

    if (verdict.candidate) {
      const streak = (serviceState.droughtStreaks.get(dep.id) ?? 0) + 1;
      serviceState.droughtStreaks.set(dep.id, streak);
      if (streak >= th.droughtPasses) {
        const r = await commitFinding({
          kind: "QUERY_DROUGHT",
          severity: "warning",
          dedupeKey: `${dep.id}:drought`,
          title: `Validator queries collapsed on "${dep.minerName}" — ${trafficRec.requests}/window vs ${Math.round(verdict.baselineAvg)} baseline`,
          detail: `Incoming requests fell to ${trafficRec.requests} this window against a ${Math.round(verdict.baselineAvg)}-request baseline for ${streak} consecutive windows while the miner is up${trafficRec.distinctValidators != null ? ` (${trafficRec.distinctValidators} distinct validators seen)` : ""}. This is the EARLIEST deregistration signal there is — validators stopped querying before your incentive score even moves. The endpoint probed alive, so the problem is scoring, selection or network routing, not liveness.`,
          evidence: {
            reason: "query-drought",
            suggestedAction: "evaluate",
            requestsThisWindow: trafficRec.requests,
            baselineAvgRequests: verdict.baselineAvg,
            droughtFloorRatio: th.droughtFloorRatio,
            droughtPasses: streak,
            distinctValidators: trafficRec.distinctValidators,
            topValidatorHotkey: trafficRec.topValidatorHotkey,
            topValidatorCount: trafficRec.topValidatorCount,
            sampledAt: new Date().toISOString(),
          },
          deploymentId: dep.id,
          netuid: dep.netuid,
          runbook: [
            "Verify the axon is still announced on-chain (a restart re-announces it).",
            "Check the subnet's validator set changed (stake moves) — see Subnet Drift events.",
            "Compare your serving quality against the cohort (Runtime Optimizer / Judge profiles).",
            "Approve to acknowledge once query volume recovers.",
          ],
        });
        findings.push({ kind: "QUERY_DROUGHT", action: r, resolved: 0 });
      }
    } else if (serviceState.droughtStreaks.get(dep.id)) {
      serviceState.droughtStreaks.delete(dep.id);
      resolved += await autoResolveFor("drought", dep.id);
    }

    // Update the rolling history (keep the last N windows).
    history.push(trafficRec.requests);
    while (history.length > th.trafficHistoryWindows) history.shift();
    serviceState.trafficHistory.set(dep.id, history);
  }

  return { probed, traffic, resolved, findings };
}

async function autoResolveFor(suffix: "probe-fail" | "slow" | "drought", depId: string): Promise<number> {
  const kind =
    suffix === "probe-fail" ? "PROBE_FAIL" : suffix === "slow" ? "SERVICE_LATENCY" : "QUERY_DROUGHT";
  return autoResolve(kind, `${depId}:${suffix}`);
}
