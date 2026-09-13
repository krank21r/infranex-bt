import { db } from "@/lib/db";
import { commitFinding, autoResolve } from "./triggers-core";
import { probeAxon, resolveAxonEndpoint, rollingMedianMs, type ProbeOutcome } from "./service-health";

/**
 * TIER3 — Benchmark harness (axon-latency).
 *
 * Service health (DEVOPS-4) answers "is the axon alive and not slow RIGHT
 * NOW" with single probes. The harness adds the historical dimension:
 * periodic multi-sample benchmark runs recorded to BenchmarkRun, a rolling
 * baseline per deployment, and regression events when the latest run is
 * meaningfully slower than what this miner used to do:
 *
 *   run  = 5 sequential synthetic validator probes (probeAxon)
 *   row  = samples / okCount / p50 / p95 / successPct (+ mode, errors)
 *   rule = latest p50 > REGRESSION_FACTOR × baseline median (of up to
 *          BASELINE_RUNS prior successful runs, min BASELINE_MIN runs)
 *          → commit BENCH_REGRESS (deduped, refreshed while it persists)
 *   recovery = latest p50 back within factor → autoResolve
 *
 * Mock deployments get synthesized runs (mode "mock") so the panel shows a
 * living history in demos — and mock runs NEVER alarm, matching the
 * platform-wide mock semantics.
 */

export const BENCH_SAMPLES = 5;
export const BASELINE_RUNS = 10;
export const BASELINE_MIN = 3;
export const REGRESSION_FACTOR = 1.5;

export interface BenchSummary {
  samples: number;
  okCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
  successPct: number;
  errorKind: string | null;
}

/** Pure percentile math — exported so tests verify EXACTLY what runs store. */
export function summarizeProbeDurations(durationsMs: number[]): { p50: number | null; p95: number | null } {
  if (!durationsMs.length) return { p50: null, p95: null };
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const pick = (q: number) => {
    const idx = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
    return Math.round(sorted[Math.max(0, idx)]);
  };
  return { p50: pick(0.5), p95: pick(0.95) };
}

/** Deterministic pseudo-latency for mock fleets (no Math.random jitter). */
export function synthesizeMockProbe(seed: number, ok: boolean): ProbeOutcome {
  const base = 180 + ((seed * 37) % 140); // 180–319ms band
  return ok
    ? { ok: true, httpStatus: 200, ttfbMs: base, totalMs: base + 40, errorKind: null, errorDetail: null }
    : { ok: false, httpStatus: null, ttfbMs: null, totalMs: null, errorKind: "timeout", errorDetail: "simulated timeout (mock)" };
}

interface BenchDep {
  id: string;
  minerName: string;
  mode: string;
  status: string;
  netuid: number;
  hotkey: string | null;
  registeredUid: number | null;
  sshHost: string | null;
  config: string;
}

type ProbeFn = typeof probeAxon;

export interface BenchmarkRunDTO {
  id: string;
  deploymentId: string;
  at: string;
  bench: string;
  samples: number;
  okCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
  successPct: number;
  mode: string;
  errorKind: string | null;
}

export function toRunDTO(row: {
  id: string;
  deploymentId: string;
  at: Date;
  bench: string;
  samples: number;
  okCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
  successPct: number;
  mode: string;
  errorKind: string | null;
}): BenchmarkRunDTO {
  return {
    id: row.id,
    deploymentId: row.deploymentId,
    at: row.at.toISOString(),
    bench: row.bench,
    samples: row.samples,
    okCount: row.okCount,
    p50Ms: row.p50Ms,
    p95Ms: row.p95Ms,
    successPct: row.successPct,
    mode: row.mode,
    errorKind: row.errorKind,
  };
}

async function recordRun(
  dep: BenchDep,
  outcomes: ProbeOutcome[],
  mode: "mock" | "real",
  opts?: { at?: Date; note?: string }
): Promise<BenchmarkRunDTO> {
  const durations = outcomes.filter((o) => o.ok && typeof o.totalMs === "number").map((o) => o.totalMs as number);
  const { p50, p95 } = summarizeProbeDurations(durations);
  const okCount = outcomes.filter((o) => o.ok).length;
  const firstError = outcomes.find((o) => !o.ok)?.errorKind ?? null;
  const row = await db.benchmarkRun.create({
    data: {
      deploymentId: dep.id,
      at: opts?.at ?? new Date(),
      bench: "axon-latency",
      samples: outcomes.length,
      okCount,
      p50Ms: p50,
      p95Ms: p95,
      successPct: outcomes.length ? Math.round((okCount / outcomes.length) * 1000) / 10 : 0,
      mode,
      errorKind: firstError,
      detailJson: JSON.stringify({ minerName: dep.minerName, note: opts?.note ?? null }),
    },
  });
  return toRunDTO(row);
}

/** Roll the retention window — keep the newest KEEP_RUNS runs per deployment. */
export async function pruneBenchmarkRuns(deploymentId: string, keep = 50): Promise<number> {
  const count = await db.benchmarkRun.count({ where: { deploymentId } });
  if (count <= keep) return 0;
  const old = await db.benchmarkRun.findMany({
    where: { deploymentId },
    orderBy: { at: "desc" },
    skip: keep,
    select: { id: true },
  });
  if (!old.length) return 0;
  const r = await db.benchmarkRun.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  return r.count;
}

export interface BenchmarkPassResult {
  evaluatedAt: string;
  ran: number;
  regressed: number;
  recovered: number;
  runs: BenchmarkRunDTO[];
}

export interface BenchmarkPassOptions {
  probe?: ProbeFn;
  /** DI: deployments (tests). Defaults to started deployments. */
  deployments?: BenchDep[];
  at?: Date;
}

export async function runBenchmarkPass(opts?: BenchmarkPassOptions): Promise<BenchmarkPassResult> {
  const probe = opts?.probe ?? probeAxon;
  const deps =
    opts?.deployments ??
    (await db.deployment.findMany({
      where: { status: "started" },
      select: {
        id: true,
        minerName: true,
        mode: true,
        status: true,
        netuid: true,
        hotkey: true,
        registeredUid: true,
        sshHost: true,
        config: true,
      },
    }));

  const result: BenchmarkPassResult = {
    evaluatedAt: new Date().toISOString(),
    ran: 0,
    regressed: 0,
    recovered: 0,
    runs: [],
  };

  for (const dep of deps) {
    let outcomes: ProbeOutcome[];
    let mode: "mock" | "real";
    let note: string | null = null;

    if (dep.mode === "mock") {
      mode = "mock";
      // Deterministic synthesized history — mocks never alarm.
      const seed = Math.floor(Date.now() / 90_000); // changes ~per pass
      outcomes = Array.from({ length: BENCH_SAMPLES }, (_, i) => synthesizeMockProbe(seed + i, true));
      note = "simulated benchmark (mock deployment)";
    } else {
      mode = "real";
      const ep = await resolveAxonEndpoint({
        id: dep.id,
        mode: dep.mode,
        netuid: dep.netuid,
        hotkey: dep.hotkey,
        registeredUid: dep.registeredUid,
        sshHost: dep.sshHost,
        config: dep.config,
      });
      if (!ep) {
        // No endpoint to bench — record the gap, no alarm (PROBE_FAIL owns death).
        outcomes = [
          { ok: false, httpStatus: null, ttfbMs: null, totalMs: null, errorKind: null, errorDetail: "axon endpoint unresolvable" },
        ];
        note = "axon endpoint unresolvable — run recorded as a gap";
      } else {
        outcomes = [];
        for (let i = 0; i < BENCH_SAMPLES; i++) {
          try {
            outcomes.push(await probe(ep.endpoint, ep.port, 8_000));
          } catch (e) {
            outcomes.push({ ok: false, httpStatus: null, ttfbMs: null, totalMs: null, errorKind: null, errorDetail: e instanceof Error ? e.message : "probe wrapper error" });
          }
        }
      }
    }

    const run = await recordRun(dep, outcomes, mode, { at: opts?.at, note: note ?? undefined });
    result.runs.push(run);
    result.ran++;

    // ---- Regression rule (real runs only — mocks never alarm) -----------
    if (mode !== "real") continue;

    const history = await db.benchmarkRun.findMany({
      where: { deploymentId: dep.id, mode: "real", p50Ms: { not: null } },
      orderBy: { at: "desc" },
      take: BASELINE_RUNS + 1,
    });
    const baselineRows = history.slice(1).filter((r) => (r.p50Ms ?? 0) > 0 && r.okCount > 0);
    const baselineP50 = rollingMedianMs(baselineRows.slice(0, BASELINE_RUNS).map((r) => r.p50Ms as number));
    const latestP50 = run.p50Ms;

    if (baselineP50 !== null && baselineRows.length >= BASELINE_MIN && latestP50 !== null) {
      if (latestP50 > baselineP50 * REGRESSION_FACTOR) {
        await commitFinding({
          kind: "BENCH_REGRESS",
          severity: "warning",
          dedupeKey: dep.id,
          title: `Benchmark regression on "${dep.minerName}" — p50 ${latestP50}ms vs ${Math.round(baselineP50)}ms baseline`,
          detail:
            `Latest axon-latency run p50 (${latestP50}ms) exceeds ${REGRESSION_FACTOR}× the rolling baseline ` +
            `(${Math.round(baselineP50)}ms over ${baselineRows.length} runs). Success ${run.successPct}%. ` +
            `Approving acknowledges and logs it — if latency stays high, the Runtime Optimizer's accelerated profiles are the fix path.`,
          evidence: {
            latestP50Ms: latestP50,
            latestP95Ms: run.p95Ms,
            baselineP50Ms: Math.round(baselineP50),
            baselineRuns: baselineRows.length,
            samples: run.samples,
            okCount: run.okCount,
            successPct: run.successPct,
            suggestedAction: "review",
          },
          deploymentId: dep.id,
          netuid: dep.netuid,
          runbook: [
            "Compare the latest run against the baseline in the Benchmark panel.",
            "Check GPU saturation / thermal state on the miner card (idle GPU + high latency = upstream scoring, not the miner).",
            "If it persists, the Runtime Optimizer's accelerated serving profiles (vLLM batching, TensorRT-LLM, AWQ/EXL2) are the fix path.",
          ],
        });
        result.regressed++;
      } else {
        const resolved = await autoResolve("BENCH_REGRESS", dep.id);
        if (resolved) result.recovered += resolved;
      }
    }

    await pruneBenchmarkRuns(dep.id);
  }

  return result;
}
