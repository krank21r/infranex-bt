import {
  type JudgeProfileData,
  type MinerSpec,
  type SimulationResult,
  type DimensionScore,
  type Verdict,
  type Recommendation,
  DIMENSION_CATALOG,
} from "./types";

/**
 * Mock-validator harness — simulate "if I run THIS miner, how does the
 * judge's composite score me?"
 *
 * All curves are DETERMINISTIC and pure — the same spec against the same
 * profile always produces the same result. These are models of judge
 * behaviour, not the judge itself; the disclaimer says so.
 */

// ---------------------------------------------------------------------------
// Per-dimension scoring curves (all return 0-1)
// ---------------------------------------------------------------------------

/**
 * Speed: log-linear sigmoid against the judge's deadline. At latency =
 * deadline → 0.5; 10× faster → ~0.97; 10× slower → ~0.03.
 */
export function speedScore(latencyMs: number, deadlineMs: number): number {
  const d = Math.max(deadlineMs, 100);
  const r = latencyMs / d;
  return clamp01(1 / (1 + Math.pow(r, 1.5)));
}

/**
 * Availability: quadratic tail — missing the last percent hurts hard.
 * 99.5% → 0.9025, 95% → 0.25, 90% → 0.
 */
export function availabilityScore(uptimePct: number): number {
  const u = clamp01(uptimePct / 100);
  const tail = clamp01((u - 0.9) / 0.1);
  return tail * tail;
}

/** Quality: mildly concave — the last few points are worth slightly less. */
export function qualityScore(qualityPct: number): number {
  return Math.pow(clamp01(qualityPct / 100), 1.2);
}

/**
 * Throughput: saturating against a reference — matching the reference earns
 * ~0.63, double the reference ~0.86.
 */
export function throughputScore(tps: number, referenceTps: number): number {
  const ref = Math.max(referenceTps, 0.1);
  return clamp01(1 - Math.exp(-tps / ref));
}

/** Price: lower is better; at the reference price → 0.5; free → 1. */
export function priceScore(priceUsd: number, referenceUsd: number): number {
  const ref = Math.max(referenceUsd, 0.01);
  return clamp01(1 - priceUsd / (2 * ref));
}

// ---------------------------------------------------------------------------
// Verdict + percentile
// ---------------------------------------------------------------------------

export function verdictFor(composite: number): Verdict {
  if (composite >= 75) return "strong";
  if (composite >= 60) return "competitive";
  if (composite >= 45) return "marginal";
  return "weak";
}

/** Cohort-median composite implied by the cohort's brutality (0-100). */
export function medianCompositeFor(brutality: number): number {
  return 30 + brutality * 0.25; // forgiving ~34 … shark_tank ~55
}

/** Logistic percentile estimate, cohort-aware. */
export function percentileFor(composite: number, brutality: number): number {
  const median = medianCompositeFor(brutality);
  // Scale widens for forgiving cohorts (scores spread out), tightens for
  // shark tanks (everyone clusters low).
  const scale = 14 - brutality * 0.05; // 14 … 9
  const p = 100 / (1 + Math.exp(-(composite - median) / Math.max(scale, 1)));
  return Math.max(1, Math.min(99, Math.round(p)));
}

// ---------------------------------------------------------------------------
// Reference points per archetype (used when the cohort gives no better data)
// ---------------------------------------------------------------------------

const THROUGHPUT_REFERENCE: Record<string, number> = {
  latency_race: 30,
  quality_judge: 10,
  market_clearing: 25,
  uptime_sla: 20,
  resource_fit: 15,
  unknown: 20,
};

const PRICE_REFERENCE: Record<string, number> = {
  latency_race: 0.6,
  quality_judge: 1.5,
  market_clearing: 0.5,
  uptime_sla: 0.8,
  resource_fit: 1.0,
  unknown: 0.8,
};

/** "Good enough" level recommendations aim for. */
const GOOD_LEVEL: Record<string, number> = {
  response_speed: 0.9,
  response_quality: 0.9,
  availability: 0.9,
  price: 0.75,
  throughput: 0.85,
  resource_efficiency: 0.9,
};

// ---------------------------------------------------------------------------
// Main simulation
// ---------------------------------------------------------------------------

export function simulateAgainstProfile(
  profile: JudgeProfileData,
  spec: MinerSpec
): SimulationResult {
  const deadlineMs = profile.dimensions.length ? inferDeadline(profile) : 30_000;
  const throughputRef = THROUGHPUT_REFERENCE[profile.judgeKind] ?? 20;
  const priceRef = PRICE_REFERENCE[profile.judgeKind] ?? 0.8;

  const dimScores: DimensionScore[] = [];

  for (const dim of profile.dimensions) {
    let score = 0;
    let note = "";
    switch (dim.key) {
      case "response_speed":
        score = speedScore(spec.latencyMs, deadlineMs);
        note = `${(spec.latencyMs / 1000).toFixed(2)}s vs ~${(deadlineMs / 1000).toFixed(0)}s deadline → sigmoid ${score.toFixed(2)}`;
        break;
      case "response_quality":
        score = qualityScore(spec.qualityPct);
        note = `quality ${spec.qualityPct}% → ${score.toFixed(2)}`;
        break;
      case "availability":
        score = availabilityScore(spec.uptimePct);
        note = `uptime ${spec.uptimePct}% → quadratic tail ${score.toFixed(2)}`;
        break;
      case "throughput":
        score = throughputScore(spec.throughputTps, throughputRef);
        note = `${spec.throughputTps} tps vs ~${throughputRef} reference → ${score.toFixed(2)}`;
        break;
      case "price":
        score = priceScore(spec.pricePerMTokUsd, priceRef);
        note = `$${spec.pricePerMTokUsd.toFixed(2)}/1M vs ~$${priceRef.toFixed(2)} reference → ${score.toFixed(2)}`;
        break;
      case "resource_efficiency":
        // No direct spec field — approximate from latency/quality product.
        score = clamp01(0.5 + (qualityScore(spec.qualityPct) - 0.6) * 0.5);
        note = "approximated from spec quality (no direct field)";
        break;
      default:
        score = 0.5;
        note = "unknown dimension → neutral";
    }
    dimScores.push({
      key: dim.key,
      label: dim.label,
      weight: dim.weight,
      score,
      contribution: dim.weight * score,
      note,
    });
  }

  const compositeRaw = dimScores.reduce((a, d) => a + d.contribution, 0);
  const composite = Math.round(compositeRaw * 1000) / 10;

  const percentile = percentileFor(composite, profile.cohort.brutality);
  const medianComposite = medianCompositeFor(profile.cohort.brutality);
  const medianMultiple = Math.round((composite / medianComposite) * 100) / 100;

  return {
    netuid: profile.netuid,
    subnetName: profile.subnetName,
    judgeKind: profile.judgeKind,
    composite,
    verdict: verdictFor(composite),
    percentileEstimate: percentile,
    medianMultiple,
    dimensionScores: dimScores,
    recommendations: rankRecommendations(dimScores, spec),
    disclaimer:
      "Deterministic model of this judge's behaviour — not the actual validator. Calibrate with small stakes first.",
  };
}

/** Highest-leverage fixes: composite gain if each dimension reached "good". */
function rankRecommendations(
  dimScores: DimensionScore[],
  _spec: MinerSpec
): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const d of dimScores) {
    const good = GOOD_LEVEL[d.key] ?? 0.9;
    const gain = Math.max(0, (good - d.score) * d.weight * 100);
    if (gain < 0.5) continue; // not worth mentioning
    recs.push({
      dimensionKey: d.key,
      label: d.label,
      gain: Math.round(gain * 10) / 10,
      text: recText(d.key, d, good),
    });
  }
  return recs.sort((a, b) => b.gain - a.gain).slice(0, 3);
}

function recText(key: string, d: DimensionScore, good: number): string {
  const label = d.label;
  switch (key) {
    case "response_speed":
      return `${label} is the biggest lever (+${d.score < 0.3 ? "huge" : "significant"}): cut response latency toward the deadline — currently scoring ${d.score.toFixed(2)}/${good.toFixed(2)}.`;
    case "response_quality":
      return `Raise output ${label.toLowerCase()} (better model, better prompts, self-verification) — currently ${d.score.toFixed(2)}/${good.toFixed(2)}.`;
    case "availability":
      return `${label} is quadratic here — a small uptime drop costs a lot of composite. Add auto-restart + health monitoring (currently ${d.score.toFixed(2)}).`;
    case "price":
      return `Cut asking price or improve ${label.toLowerCase()} positioning — currently ${d.score.toFixed(2)}/${good.toFixed(2)}.`;
    case "throughput":
      return `Increase ${label.toLowerCase()} (batching, faster inference engine) — currently ${d.score.toFixed(2)}/${good.toFixed(2)}.`;
    case "resource_efficiency":
      return `Improve ${label.toLowerCase()} (quantization, smaller model within quality budget) — currently ${d.score.toFixed(2)}.`;
    default:
      return `Improve ${label} — currently ${d.score.toFixed(2)}/${good.toFixed(2)}.`;
  }
}

function inferDeadline(profile: JudgeProfileData): number {
  // The service layer stores the mined deadline in the profile summary only;
  // re-derive a sensible default from the archetype when unknown.
  const defaults: Record<string, number> = {
    latency_race: 10_000,
    quality_judge: 60_000,
    market_clearing: 30_000,
    uptime_sla: 15_000,
    resource_fit: 30_000,
    unknown: 30_000,
  };
  return defaults[profile.judgeKind] ?? 30_000;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
