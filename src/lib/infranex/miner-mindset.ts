import { db } from "@/lib/db";
import {
  fetchLiveSnapshot,
  type LiveNetworkSnapshot,
  type LiveSubnetMetrics,
} from "./chain";
import { commitFinding, autoResolve, safeParse } from "./triggers-core";
import { getDaemonView, enqueueCommand } from "./daemon-bridge";
import { deserializeConfig } from "./deployment/config";

/**
 * DEVOPS-3 — the Miner Mindset strategy pass.
 *
 * Experienced miners treat their operation like a proprietary trading firm:
 * compute is a liquid asset, runtimes are tunable instruments, and validators
 * decide the income. This pass encodes that mindset into the always-on engine
 * (runs in the same 90s devops worker, after UID defense):
 *
 *   1. SUBNET ARBITRAGE / COMPUTE RECYCLING (ARBITRAGE events)
 *      Per-miner yield on our subnet (minerEmissionTaoPerDay / miners) is
 *      baselined every pass. When the yield collapses vs the observed peak
 *      for N consecutive passes — or the subnet's alpha price is bleeding out
 *      (24h momentum) — the engine ranks every other subnet by per-miner
 *      yield and proposes recycling: spin down this miner (approval-gated
 *      terminate) and redeploy the freed GPU on the higher-yield subnet.
 *      This is the "dynamic recycled registration / compute recycling" play.
 *
 *   2. RUNTIME OPTIMIZER (RUNTIME_OPT events)
 *      Stock miner stacks leak emissions to quant-firm competitors. When
 *      telemetry shows sustained saturation (util ≥ hotUtilPct across the
 *      last samples), VRAM pressure, or a persistent incentive gap vs the
 *      rewarded cohort median, the engine proposes an accelerated serving
 *      profile: vLLM continuous batching, TensorRT-LLM, AWQ/EXL2 quantized
 *      weights, or a domain LoRA fine-tune. Approval applies the profile env
 *      on the GPU via the daemon's apply_config (env persisted on-host +
 *      miner restarted) — the same closed loop as drift remediation.
 *
 *   3. VALIDATOR AWARENESS (posture + DEREG_RISK failover)
 *      The ops board surfaces validator-side facts per miner (top-10
 *      incentive concentration, our UID's validator trust / consensus) so
 *      operators prioritize the validators that actually score them. When
 *      UID defense escalates a critical incentive collapse, the event gains
 *      a failover plan: approval pushes a fallback serving profile + restart
 *      instead of a bare restart — the "automatic failover the second
 *      incentive drops" reflex.
 *
 * Mock deployments: arbitrage IS evaluated (subnet economics are real chain
 * facts; recycle on a mock simply terminates the simulated deployment, and
 * the evidence carries mode:"mock" so the UI shows the MOCK tag). Runtime
 * signals are telemetry-based — mocks have no real telemetry, so no runtime
 * alarms; their applied profiles are simulated with a deployment tick.
 */

// ---------------------------------------------------------------------------
// Thresholds (single tuning place; MINDSET-thresholds ride the monitor payload)
// ---------------------------------------------------------------------------

export const MINDSET_THRESHOLDS = {
  /** Relative per-miner yield drop (vs observed peak) that marks a collapse. */
  yieldCollapsePct: 0.4,
  /** Consecutive passes the collapse must hold before the arbitrage event. */
  yieldCollapsePasses: 3,
  /** 24h alpha price change (%) that alone signals capital outflow. */
  alphaDropPct24h: -15,
  /** An alternative subnet must promise at least this much more per-miner yield. */
  arbitrageUpliftPct: 0.5,
  /** Alternatives kept in evidence / posture. */
  maxAlternatives: 3,
  /** GPU utilization (%) considered saturation across recent samples. */
  hotUtilPct: 85,
  /** Recent saturated samples required before proposing a batching runtime. */
  hotUtilSamples: 3,
  /** VRAM pressure ratio (used/total) that favors quantized weights. */
  memPressureRatio: 0.9,
  /** Our incentive below this fraction of the rewarded median is a gap. */
  incentiveGapRatio: 0.5,
  /** Consecutive passes of the gap before proposing the fine-tune path. */
  incentiveGapPasses: 3,
} as const;

/** Widened (non-literal) view of the thresholds for DI and internal plumbing. */
export type MindsetThresholds = { [K in keyof typeof MINDSET_THRESHOLDS]: number };

// ---------------------------------------------------------------------------
// Pass state — yield baselines + consecutive counters (globalThis singleton)
// ---------------------------------------------------------------------------

interface YieldBaseline {
  peak: number;
  last: number;
  collapsePasses: number;
  at: number;
}

interface MindsetPassState {
  yieldBaselines: Map<string, YieldBaseline>;
  incentiveGapStreak: Map<string, number>;
  lastRunAt: number | null;
}

const globalForMindset = globalThis as unknown as {
  __infranexMindsetPass: MindsetPassState | undefined;
};

const mindsetState: MindsetPassState =
  globalForMindset.__infranexMindsetPass ??
  (globalForMindset.__infranexMindsetPass = {
    yieldBaselines: new Map(),
    incentiveGapStreak: new Map(),
    lastRunAt: null,
  });

// ---------------------------------------------------------------------------
// Runtime recipe catalog — the quant-firm serving stack
// ---------------------------------------------------------------------------

export interface RuntimeRecipe {
  id: "vllm" | "tensorrt" | "awq4" | "exl2" | "lora";
  label: string;
  engine: string;
  quantization: string | null;
  expectedGain: string;
  envDelta: Record<string, string>;
  reason?: string;
}

export const RUNTIME_RECIPES: Record<RuntimeRecipe["id"], RuntimeRecipe> = {
  vllm: {
    id: "vllm",
    label: "vLLM continuous batching",
    engine: "vLLM",
    quantization: null,
    expectedGain: "2-4× throughput under concurrent validator load",
    envDelta: { INFANEX_RUNTIME: "vllm", VLLM_ENABLE_CHUNKED_PREFILL: "1" },
  },
  tensorrt: {
    id: "tensorrt",
    label: "TensorRT-LLM serving",
    engine: "TensorRT-LLM",
    quantization: null,
    expectedGain: "up to 3× lower time-to-first-token",
    envDelta: { INFANEX_RUNTIME: "tensorrt-llm" },
  },
  awq4: {
    id: "awq4",
    label: "AWQ 4-bit quantized weights",
    engine: "AWQ",
    quantization: "4-bit",
    expectedGain: "~1.5-2× faster TTFT, ~50% VRAM freed",
    envDelta: { INFANEX_QUANT: "awq4" },
  },
  exl2: {
    id: "exl2",
    label: "EXL2 adaptive quantization",
    engine: "ExLlamaV2",
    quantization: "4-8-bit",
    expectedGain: "flexible VRAM/quality trade, faster decode",
    envDelta: { INFANEX_QUANT: "exl2" },
  },
  lora: {
    id: "lora",
    label: "Domain LoRA fine-tune",
    engine: "PEFT/LoRA",
    quantization: null,
    expectedGain: "quality edge vs stock-weight cohorts",
    envDelta: { INFANEX_TUNED: "lora" },
  },
};

/** Pure recipe selection — unit-testable, shared by the pass and the posture. */
export function pickRuntimeRecipes(signals: {
  saturatedUtil: boolean;
  memPressure: boolean;
  incentiveGap: boolean;
}): RuntimeRecipe[] {
  const out: RuntimeRecipe[] = [];
  if (signals.memPressure) {
    out.push({
      ...RUNTIME_RECIPES.awq4,
      reason: "VRAM headroom nearly exhausted — quantized weights free memory and restore serving headroom",
    });
  }
  if (signals.saturatedUtil) {
    out.push({
      ...RUNTIME_RECIPES.vllm,
      reason: "GPU saturated near full utilization — continuous batching multiplies served throughput",
    });
  }
  if (signals.incentiveGap) {
    if (!out.some((r) => r.id === "vllm" || r.id === "awq4")) {
      out.push({
        ...RUNTIME_RECIPES.tensorrt,
        reason: "Incentive lags the rewarded cohort — latency-sensitive scoring favors a faster runtime",
      });
    }
    out.push({
      ...RUNTIME_RECIPES.lora,
      reason: "Incentive lags the rewarded cohort — a domain fine-tune is the durable quality edge",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Arbitrage math (pure, exported for tests)
// ---------------------------------------------------------------------------

/** Per-miner yield on a subnet: miner emission share split across miners. */
export function perMinerYieldTaoPerDay(s: LiveSubnetMetrics): number | null {
  const miners = typeof s.minersCount === "number" ? s.minersCount : 0;
  const total = typeof s.minerEmissionTaoPerDay === "number" ? s.minerEmissionTaoPerDay : 0;
  if (miners <= 0 || total <= 0) return null;
  return total / miners;
}

export interface ArbitrageAlternative {
  netuid: number;
  name: string;
  perMinerYieldTaoPerDay: number;
  upliftPct: number;
  burnCostTao: number | null;
  alphaChange24h: number | null;
  freeSlots: number | null;
}

/** Rank alternative subnets by per-miner yield, filtered by uplift + capacity. */
export function rankArbitrageTargets(
  ourNetuid: number,
  ourYield: number,
  subnets: LiveSubnetMetrics[],
  th: MindsetThresholds
): ArbitrageAlternative[] {
  const out: ArbitrageAlternative[] = [];
  for (const s of subnets) {
    if (s.netuid === ourNetuid) continue;
    if (s.emissionEnabled === false) continue;
    const y = perMinerYieldTaoPerDay(s);
    if (y === null) continue;
    const uplift = ourYield > 0 ? y / ourYield - 1 : 0;
    if (uplift < th.arbitrageUpliftPct) continue;
    const freeSlots =
      typeof s.maxUids === "number"
        ? s.maxUids - (typeof s.minersCount === "number" ? s.minersCount : 0) -
          (typeof s.validatorsCount === "number" ? s.validatorsCount : 0)
        : null;
    if (freeSlots !== null && freeSlots < 1) continue;
    out.push({
      netuid: s.netuid,
      name: s.name ?? `α${s.netuid}`,
      perMinerYieldTaoPerDay: y,
      upliftPct: uplift,
      burnCostTao: s.burnCostTao ?? null,
      alphaChange24h: s.alphaPriceChange24h ?? null,
      freeSlots,
    });
  }
  return out
    .sort((a, b) => b.perMinerYieldTaoPerDay - a.perMinerYieldTaoPerDay)
    .slice(0, th.maxAlternatives);
}

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const pct = (x: number) => `${Math.round(x * 100)}%`;

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

export interface MindsetPassResult {
  evaluatedAt: string;
  deploymentsEvaluated: number;
  created: number;
  refreshed: number;
  resolved: number;
  findings: {
    deploymentId: string;
    kind: "ARBITRAGE" | "RUNTIME_OPT";
    action: string;
  }[];
}

export interface MindsetPassOptions {
  /** DI for tests — defaults to the cached live snapshot. */
  fetchSnapshot?: () => Promise<LiveNetworkSnapshot | null>;
  /** Threshold overrides (tests / tuning) — widened to plain numbers. */
  thresholds?: Partial<{ [K in keyof typeof MINDSET_THRESHOLDS]: number }>;
}

export async function runMinerMindsetPass(opts?: MindsetPassOptions): Promise<MindsetPassResult> {
  const th: MindsetThresholds = { ...MINDSET_THRESHOLDS, ...(opts?.thresholds ?? {}) };
  const fetchSnapshot =
    opts?.fetchSnapshot ??
    (async () => {
      try {
        return await fetchLiveSnapshot();
      } catch {
        return null;
      }
    });

  const deps = await db.deployment.findMany({ where: { status: "started" } });
  const snapshot = await fetchSnapshot();
  const subnets = snapshot && Array.isArray(snapshot.subnets) ? snapshot.subnets : [];

  const result: MindsetPassResult = {
    evaluatedAt: new Date().toISOString(),
    deploymentsEvaluated: 0,
    created: 0,
    refreshed: 0,
    resolved: 0,
    findings: [],
  };

  for (const dep of deps) {
    result.deploymentsEvaluated++;

    // ---- Strategy 5: subnet arbitrage / compute recycling ----------------
    const arb = await evaluateArbitrage(dep, subnets, th);
    for (const f of arb.findings) {
      if (f.action === "created") result.created++;
      else if (f.action === "refreshed") result.refreshed++;
      result.findings.push({ deploymentId: dep.id, kind: "ARBITRAGE", action: f.action });
    }
    result.resolved += arb.resolved;

    // ---- Strategy 2: runtime optimizer ------------------------------------
    const rt = await evaluateRuntime(dep, th);
    for (const f of rt.findings) {
      if (f.action === "created") result.created++;
      else if (f.action === "refreshed") result.refreshed++;
      result.findings.push({ deploymentId: dep.id, kind: "RUNTIME_OPT", action: f.action });
    }
    result.resolved += rt.resolved;
  }

  mindsetState.lastRunAt = Date.now();
  return result;
}

type MindsetDep = {
  id: string;
  minerName: string;
  netuid: number;
  subnetName: string;
  mode: string;
  hotkey: string | null;
};
type EvaluatorOut = { resolved: number; findings: { action: string }[] };

// ---------------------------------------------------------------------------
// Arbitrage evaluator — compute is liquid
// ---------------------------------------------------------------------------

async function evaluateArbitrage(
  dep: MindsetDep,
  subnets: LiveSubnetMetrics[],
  th: MindsetThresholds
): Promise<EvaluatorOut> {
  const our = subnets.find((s) => s.netuid === dep.netuid);
  const ourYield = our ? perMinerYieldTaoPerDay(our) : null;
  if (!our || ourYield === null) {
    // Unknown/empty subnet (e.g. mock netuids) — nothing to baseline.
    mindsetState.yieldBaselines.delete(dep.id);
    return { resolved: 0, findings: [] };
  }

  const base = mindsetState.yieldBaselines.get(dep.id) ?? {
    peak: ourYield,
    last: ourYield,
    collapsePasses: 0,
    at: Date.now(),
  };
  const peak = Math.max(base.peak, ourYield);
  const dropPct = peak > 0 ? 1 - ourYield / peak : 0;
  const collapsing = dropPct >= th.yieldCollapsePct;
  const collapsePasses = collapsing ? base.collapsePasses + 1 : 0;
  const alpha = typeof our.alphaPriceChange24h === "number" ? our.alphaPriceChange24h : null;
  const alphaDrop = alpha !== null && alpha <= th.alphaDropPct24h;
  mindsetState.yieldBaselines.set(dep.id, { peak, last: ourYield, collapsePasses, at: Date.now() });

  if (collapsePasses >= th.yieldCollapsePasses || alphaDrop) {
    const targets = rankArbitrageTargets(dep.netuid, ourYield, subnets, th);
    const best = targets[0] ?? null;
    const severity = dropPct >= 0.6 ? "critical" : "warning";
    const actionable = best !== null;
    const trigger = collapsePasses >= th.yieldCollapsePasses ? "yield_collapse" : "alpha_outflow";

    const r = await commitFinding({
      kind: "ARBITRAGE",
      severity,
      dedupeKey: dep.id,
      title: actionable
        ? `Recycle compute — α${dep.netuid} yield down ${pct(dropPct)}; α${best.netuid} ${best.name} pays ${pct(best.upliftPct)} more`
        : `Compute recycling candidate — α${dep.netuid} yield down ${pct(dropPct)}, no better home right now`,
      detail:
        `Per-miner yield on α${dep.netuid} ${dep.subnetName} fell to ${r4(ourYield)} TAO/day ` +
        `(observed peak ${r4(peak)}${trigger === "alpha_outflow" ? "" : `, ${collapsePasses} pass${collapsePasses === 1 ? "" : "es"}`})` +
        `${alpha !== null ? `; alpha price ${alpha}% in 24h` : ""}. ` +
        (actionable
          ? `Approval spins down this miner (billing stops, GPU freed) for redeployment on α${best.netuid} ${best.name} at ≈${r4(best.perMinerYieldTaoPerDay)} TAO/day per miner. `
          : `No alternative clears the +${pct(th.arbitrageUpliftPct)} uplift bar — approval marks the decision and routes to the Optimization Engine. `) +
        `Mode ${dep.mode}${dep.mode === "mock" ? " — actions are simulated on mock deployments" : ""}.`,
      evidence: {
        type: actionable ? "recycle" : "evaluate",
        suggestedAction: actionable ? "recycle" : "evaluate",
        mode: dep.mode,
        ourNetuid: dep.netuid,
        ourSubnet: dep.subnetName,
        perMinerYieldTaoPerDay: r4(ourYield),
        peakYieldTaoPerDay: r4(peak),
        dropPct: Math.round(dropPct * 1000) / 1000,
        alphaChange24h: alpha,
        trigger,
        target: best,
        alternatives: targets,
        sampledAt: new Date().toISOString(),
      },
      deploymentId: dep.id,
      netuid: dep.netuid,
      runbook: actionable
        ? [
            `Confirm the collapse is structural (alpha outflow, emission cut) — not a one-epoch dip.`,
            `Approve to terminate this deployment — billing stops and the GPU capacity is freed.`,
            `Re-deploy on α${best.netuid} ${best.name} (≈${r4(best.perMinerYieldTaoPerDay)} TAO/day per miner; registration burn ≈${best.burnCostTao ?? "?"} TAO).`,
          ]
        : [
            `Confirm the collapse is structural — not a one-epoch dip.`,
            `No higher-yield subnet clears the uplift threshold right now; hold capacity.`,
            `Open the Optimization Engine to cut hardware cost while the engine keeps re-ranking opportunities.`,
          ],
    });
    return { resolved: 0, findings: [{ action: r }] };
  }

  const resolved = await autoResolve("ARBITRAGE", dep.id);
  return { resolved, findings: [] };
}

// ---------------------------------------------------------------------------
// Runtime optimizer — the serving stack is a tunable instrument
// ---------------------------------------------------------------------------

async function evaluateRuntime(dep: MindsetDep, th: MindsetThresholds): Promise<EvaluatorOut> {
  if (dep.mode === "mock") {
    // No real telemetry on simulated pods — never runtime-alarm a mock.
    mindsetState.incentiveGapStreak.delete(dep.id);
    const resolved = await autoResolve("RUNTIME_OPT", dep.id);
    return { resolved, findings: [] };
  }

  const samples = await db.gpuSample.findMany({
    where: { deploymentId: dep.id },
    orderBy: { createdAt: "desc" },
    take: Math.max(th.hotUtilSamples, 3),
  });
  const recent = samples.slice(0, Math.max(th.hotUtilSamples, 3));
  const withTelemetry = recent.filter((s) => s.gpuUtilPct !== null || s.memTotalMb !== null);
  const saturatedUtil =
    withTelemetry.length >= th.hotUtilSamples &&
    recent.slice(0, th.hotUtilSamples).every((s) => (s.gpuUtilPct ?? 0) >= th.hotUtilPct);
  const memPressure =
    withTelemetry.length > 0 &&
    recent.some((s) =>
      s.memTotalMb && s.memTotalMb > 0
        ? (s.memUsedMb ?? 0) / s.memTotalMb >= th.memPressureRatio
        : false
    );

  // Incentive gap — needs N consecutive passes below the rewarded median.
  let incentiveGap = false;
  const uid = await db.uidSnapshot.findFirst({
    where: { deploymentId: dep.id },
    orderBy: { createdAt: "desc" },
  });
  if (uid && uid.uid !== null && uid.incentive !== null) {
    const { getUidState } = await import("./metagraph");
    const state = await getUidState(dep.netuid, dep.hotkey).catch(() => null);
    const median = state?.cohort?.medianRewardedIncentive ?? 0;
    if (state && median > 0) {
      incentiveGap = uid.incentive < median * th.incentiveGapRatio;
    }
  }
  const gapStreak = incentiveGap ? (mindsetState.incentiveGapStreak.get(dep.id) ?? 0) + 1 : 0;
  mindsetState.incentiveGapStreak.set(dep.id, gapStreak);

  if (!saturatedUtil && !memPressure && gapStreak < th.incentiveGapPasses) {
    const resolved = await autoResolve("RUNTIME_OPT", dep.id);
    return { resolved, findings: [] };
  }

  const recipes = pickRuntimeRecipes({ saturatedUtil, memPressure, incentiveGap: gapStreak >= th.incentiveGapPasses });
  if (recipes.length === 0) {
    const resolved = await autoResolve("RUNTIME_OPT", dep.id);
    return { resolved, findings: [] };
  }

  const envDelta: Record<string, string> = {};
  for (const r of recipes) Object.assign(envDelta, r.envDelta);
  const latest = recent[0];
  const memRatio =
    latest && latest.memTotalMb && latest.memTotalMb > 0
      ? Math.round(((latest.memUsedMb ?? 0) / latest.memTotalMb) * 100) / 100
      : null;

  const r = await commitFinding({
    kind: "RUNTIME_OPT",
    severity: "warning",
    dedupeKey: dep.id,
    title: `Runtime upgrade for "${dep.minerName}" — ${recipes.map((x) => x.label).join(" + ")}`,
    detail:
      `Signals: ` +
      [
        saturatedUtil ? `utilization ≥${th.hotUtilPct}% across the last ${th.hotUtilSamples} samples` : null,
        memPressure ? `VRAM pressure ≥${Math.round(th.memPressureRatio * 100)}%` : null,
        gapStreak >= th.incentiveGapPasses
          ? `incentive below ${Math.round(th.incentiveGapRatio * 100)}% of the rewarded median for ${gapStreak} passes`
          : null,
      ]
        .filter(Boolean)
        .join("; ") +
      `. Speed and quality are what validators score — approval applies the accelerated serving profile on the GPU and restarts the miner under it.`,
    evidence: {
      suggestedAction: "apply_runtime",
      mode: dep.mode,
      signals: {
        utilPct: latest?.gpuUtilPct ?? null,
        tempC: latest?.tempC ?? null,
        memRatio,
        incentive: uid?.incentive ?? null,
        gapStreak,
      },
      recipes: recipes.map((x) => ({
        id: x.id,
        label: x.label,
        engine: x.engine,
        quantization: x.quantization,
        reason: x.reason,
        expectedGain: x.expectedGain,
      })),
      envDelta,
      sampledAt: new Date().toISOString(),
    },
    deploymentId: dep.id,
    netuid: dep.netuid,
    runbook: [
      "Confirm the pod has headroom for the new runtime (disk, VRAM) — quantized profiles free VRAM rather than needing it.",
      "Approve to apply the runtime profile on the GPU (env persisted on-host, miner restarted).",
      "Watch incentive for 24-48h; the engine auto-resolves the event when signals normalize.",
    ],
  });
  return { resolved: 0, findings: [{ action: r }] };
}

// ---------------------------------------------------------------------------
// Executors — the approval-gated GPU side (wired into triggers.actOnTrigger)
// ---------------------------------------------------------------------------

export interface ApplyRuntimeResult {
  note: string;
  applied: string[];
  transport: "daemon" | "mock" | "platform-only";
}

/**
 * Apply a runtime optimization profile to a GPU miner: merge the recipes'
 * env delta into the deployment config (durable), then push via the daemon's
 * apply_config (env persisted on-host + miner restarted). Mock deployments
 * get a simulated tick. Recipe ids default to the approved RUNTIME_OPT event.
 */
export async function applyRuntimeOptimization(
  deploymentId: string,
  opts?: { recipeIds?: string[] }
): Promise<ApplyRuntimeResult> {
  const row = await db.deployment.findUnique({ where: { id: deploymentId } });
  if (!row) throw new Error("Deployment not found");

  let recipeIds = opts?.recipeIds ?? [];
  if (recipeIds.length === 0) {
    const ev = await db.triggerEvent.findFirst({
      where: { kind: "RUNTIME_OPT", deploymentId, status: "approved" },
      orderBy: { updatedAt: "desc" },
    });
    const evidence = ev ? safeParse(ev.evidenceJson) : {};
    const list = Array.isArray(evidence.recipes) ? evidence.recipes : [];
    recipeIds = list
      .map((x) => (x && typeof x === "object" && typeof (x as Record<string, unknown>).id === "string"
        ? ((x as Record<string, unknown>).id as string)
        : ""))
      .filter(Boolean);
  }
  if (recipeIds.length === 0) {
    return { note: "No runtime recipe bound to this event — nothing applied.", applied: [], transport: "platform-only" };
  }

  const envDelta: Record<string, string> = {};
  const applied: string[] = [];
  for (const id of recipeIds) {
    const recipe = RUNTIME_RECIPES[id as RuntimeRecipe["id"]];
    if (!recipe) continue;
    Object.assign(envDelta, recipe.envDelta);
    applied.push(`${recipe.label} (${Object.keys(recipe.envDelta).join(", ")})`);
  }
  if (Object.keys(envDelta).length === 0) {
    return { note: `Unknown recipe ids (${recipeIds.join(", ")}) — nothing applied.`, applied: [], transport: "platform-only" };
  }

  // Durable platform-side config update.
  // TIER2 — snapshot the live config BEFORE the runtime optimization writes,
  // so an over-aggressive profile is one rollback away.
  try {
    const cfg = deserializeConfig(row.config);
    if (cfg) {
      const { snapshotRevision } = await import("./deployment/revisions");
      await snapshotRevision(
        row.id,
        "runtime-opt",
        `before runtime optimization: ${applied.slice(0, 2).join("; ")}`,
        "engine"
      ).catch(() => null);
      const envVars = Array.isArray(cfg.docker.envVars) ? [...cfg.docker.envVars] : [];
      for (const [k, v] of Object.entries(envDelta)) {
        const i = envVars.findIndex((e) => e.name === k);
        if (i >= 0) envVars[i] = { name: k, value: v, secret: false };
        else envVars.push({ name: k, value: v, secret: false });
      }
      cfg.docker.envVars = envVars;
      await db.deployment.update({
        where: { id: row.id },
        data: { config: JSON.stringify(cfg) },
      });
      applied.push("deployment config env updated");
    } else {
      applied.push("deployment config left untouched (empty)");
    }
  } catch {
    applied.push("deployment config left untouched (unparseable)");
  }

  const daemon = await getDaemonView(row.id).catch(() => null);
  if (daemon && daemon.status !== "unreachable") {
    await enqueueCommand(row.id, "apply_config", { env: envDelta });
    return {
      note: `apply_config queued via node daemon — runtime env (${Object.keys(envDelta).join(", ")}) persisted on-host; the miner restarts under the accelerated profile within 60s.`,
      applied,
      transport: "daemon",
    };
  }
  if (row.mode === "mock") {
    const { tickDeployment } = await import("./deployment/engine");
    await tickDeployment(row.id).catch(() => null);
    return { note: "Simulated apply — mock deployment ticked with the new runtime profile.", applied, transport: "mock" };
  }
  return {
    note: "No daemon installed on the pod — install the Node Daemon (Deployments → DevOps panel) to push apply_config; the deployment config env was updated platform-side meanwhile.",
    applied,
    transport: "platform-only",
  };
}

/** DEREG_RISK failover — automatic fallback reflex when incentive collapses. */
export function failoverFor(codes: string[], severity: string): boolean {
  return (
    severity === "critical" &&
    (codes.includes("INCENTIVE_COLLAPSE") || codes.includes("PERSISTENT_DECLINE"))
  );
}

export async function applyFailoverToGpu(deploymentId: string): Promise<{
  note: string;
  transport: "daemon" | "mock" | "platform-only";
}> {
  const row = await db.deployment.findUnique({ where: { id: deploymentId } });
  if (!row) throw new Error("Deployment not found");
  const env = { INFANEX_FAILOVER: "1", INFANEX_FAILOVER_SINCE: new Date().toISOString() };
  const daemon = await getDaemonView(row.id).catch(() => null);
  if (daemon && daemon.status !== "unreachable") {
    await enqueueCommand(row.id, "apply_config", { env });
    return {
      note: "failover profile applied via daemon (apply_config) — miner restarted in the fallback serving profile",
      transport: "daemon",
    };
  }
  if (row.mode === "mock") {
    const { tickDeployment } = await import("./deployment/engine");
    await tickDeployment(row.id).catch(() => null);
    return { note: "simulated failover — mock deployment ticked", transport: "mock" };
  }
  return {
    note: "no daemon reachable — failover profile could not be pushed to the pod",
    transport: "platform-only",
  };
}

// ---------------------------------------------------------------------------
// Ops-board posture — per-miner strategy view for the monitor payload
// ---------------------------------------------------------------------------

export interface MinerStrategyPosture {
  mindset: "earn_more" | "defend" | "optimize" | "steady";
  headline: string;
  perMinerYieldTaoPerDay: number | null;
  alphaChange24h: number | null;
  top10IncentiveShare: number | null;
  incentiveMedianShare: number | null;
  validatorTrust: number | null;
  consensus: number | null;
  bestAlternative: {
    netuid: number;
    name: string;
    upliftPct: number;
    perMinerYieldTaoPerDay: number;
    burnCostTao: number | null;
  } | null;
  recommendedRecipes: { id: string; label: string; reason: string }[];
  openMindsetEvent: boolean;
}

const HEADLINES: Record<MinerStrategyPosture["mindset"], string> = {
  earn_more: "Reallocate — a higher-yield subnet is paying more per miner",
  defend: "Defend the UID — deregistration risk active",
  optimize: "Optimize the serving stack — validators reward speed and quality",
  steady: "Steady state — hold the position, keep watching",
};

/**
 * Pure posture builder for the monitor route. Validator awareness without
 * per-validator chain reads: subnet-level incentive concentration (top-10
 * share) + our UID's validator trust / consensus from the latest snapshot.
 */
export function buildMinerStrategyPosture(input: {
  netuid: number;
  mode: string;
  uid: { riskLevel: string; validatorTrust: number | null; consensus: number | null } | null;
  recentSamples: { utilPct: number | null; memRatio: number | null }[];
  openKinds: string[];
  snapshot: LiveNetworkSnapshot | null;
  thresholds?: MindsetThresholds;
}): MinerStrategyPosture {
  const th = input.thresholds ?? MINDSET_THRESHOLDS;
  const our = input.snapshot?.subnets?.find((s) => s.netuid === input.netuid) ?? null;
  const perMinerYield = our ? perMinerYieldTaoPerDay(our) : null;
  const best =
    perMinerYield !== null
      ? (rankArbitrageTargets(input.netuid, perMinerYield, input.snapshot?.subnets ?? [], th)[0] ?? null)
      : null;

  const telemetry = input.recentSamples.filter((s) => s.utilPct !== null || s.memRatio !== null);
  const saturatedUtil =
    telemetry.length >= th.hotUtilSamples &&
    input.recentSamples.slice(0, th.hotUtilSamples).every((s) => (s.utilPct ?? 0) >= th.hotUtilPct);
  const memPressure = input.recentSamples.some((s) => (s.memRatio ?? 0) >= th.memPressureRatio);
  // Posture shows telemetry-driven recipes only; incentive-gap recipes surface
  // through the RUNTIME_OPT inbox event (needs cohort context the board has).
  const recipes = pickRuntimeRecipes({ saturatedUtil, memPressure, incentiveGap: false }).map((r) => ({
    id: r.id,
    label: r.label,
    reason: r.reason ?? r.expectedGain,
  }));

  const hasOpen = (k: string) => input.openKinds.includes(k);
  const risk = input.uid?.riskLevel ?? "healthy";
  const mindset: MinerStrategyPosture["mindset"] =
    risk === "critical"
      ? "defend"
      : hasOpen("ARBITRAGE")
        ? "earn_more"
        : hasOpen("RUNTIME_OPT")
          ? "optimize"
          : risk === "warning"
            ? "defend"
            : "steady";

  return {
    mindset,
    headline: HEADLINES[mindset],
    perMinerYieldTaoPerDay: perMinerYield !== null ? r4(perMinerYield) : null,
    alphaChange24h: our?.alphaPriceChange24h ?? null,
    top10IncentiveShare: our?.top10IncentiveShare ?? null,
    incentiveMedianShare: our?.incentiveMedianShare ?? null,
    validatorTrust: input.uid?.validatorTrust ?? null,
    consensus: input.uid?.consensus ?? null,
    bestAlternative: best
      ? {
          netuid: best.netuid,
          name: best.name,
          upliftPct: Math.round(best.upliftPct * 100) / 100,
          perMinerYieldTaoPerDay: r4(best.perMinerYieldTaoPerDay),
          burnCostTao: best.burnCostTao,
        }
      : null,
    recommendedRecipes: recipes,
    openMindsetEvent: hasOpen("ARBITRAGE") || hasOpen("RUNTIME_OPT"),
  };
}
