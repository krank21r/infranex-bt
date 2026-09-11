/**
 * Judge Intelligence — shared types.
 *
 * A "judge" is a subnet's validator scoring function. Before spending money
 * on hardware, we deconstruct HOW the judge scores miners (which dimensions
 * it rewards, how brutally it distributes incentive) and simulate a miner
 * spec against it.
 */

export const JUDGE_ARCHETYPES = [
  "latency_race",
  "quality_judge",
  "market_clearing",
  "uptime_sla",
  "resource_fit",
  "unknown",
] as const;

export type JudgeKind = (typeof JUDGE_ARCHETYPES)[number];

export const JUDGE_KIND_META: Record<
  JudgeKind,
  { label: string; blurb: string }
> = {
  latency_race: {
    label: "Latency Race",
    blurb: "Fastest complete responses take the incentive — speed dominates the score.",
  },
  quality_judge: {
    label: "Quality Judge",
    blurb: "A scoring model (or rubric) grades output quality above all else.",
  },
  market_clearing: {
    label: "Market Clearing",
    blurb: "Validators buy from the cheapest/fastest supply — price and throughput clear the market.",
  },
  uptime_sla: {
    label: "Uptime SLA",
    blurb: "Simply staying online and responsive within deadlines earns most of the incentive.",
  },
  resource_fit: {
    label: "Resource Fit",
    blurb: "The judge gates on hardware/model capacity (VRAM, model size) before anything else.",
  },
  unknown: {
    label: "Unclassified",
    blurb: "Not enough repo evidence to classify — weights shown are neutral priors.",
  },
};

/** One scored axis of a judge's composite. */
export interface JudgeDimension {
  key: string;
  label: string;
  /** Weight in the composite (Σ weights = 1). */
  weight: number;
  /** Verbatim evidence lines that justified this weight. */
  evidence: JudgeEvidence[];
}

export interface JudgeEvidence {
  /** File the line came from (e.g. "neurons/validator.py"). */
  file: string;
  /** The verbatim line (trimmed). */
  line: string;
  /** Keyword(s) that matched. */
  matched: string[];
}

/** Dimension catalog — the axes we look for in every judge. */
export const DIMENSION_CATALOG: {
  key: string;
  label: string;
  keywords: string[];
  /** Keywords too generic in README prose (infra talk, not scoring rules) —
   *  only counted in .py code files. */
  codeOnlyKeywords?: string[];
}[] = [
  {
    key: "response_speed",
    label: "Response Speed",
    keywords: [
      "latency", "timeout", "deadline", "response_time", "ttfb", "elapsed",
      "benchmark_time", "speed", "fastest", "time_limit", "processing_time",
      "asyncio.wait_for", "seconds",
    ],
  },
  {
    key: "response_quality",
    label: "Response Quality",
    keywords: [
      "quality", "reward_model", "rouge", "bleu", "accuracy", "correctness",
      "similarity", "cosine", "embedding", "grade", "evaluat", "llm_judge",
      "gpt4", "reference_answer", "win_rate",
    ],
  },
  {
    key: "availability",
    label: "Uptime / Availability",
    keywords: [
      "uptime", "availability", "downtime", "heartbeat", "health", "alive",
      "is_alive", "online", "restart", "sla", "ping", "synapse_timeout",
    ],
  },
  {
    key: "price",
    label: "Price Competitiveness",
    keywords: [
      "price", "pricing", "cost", "cheapest", "usd", "per_token", "fee",
      "rate_per", "bid", "ask",
    ],
  },
  {
    key: "throughput",
    label: "Throughput",
    keywords: [
      "throughput", "tokens_per_second", "tps", "tokens_per_minute",
      "requests_per", "concurrent", "batch_size", "capacity", "rps",
    ],
  },
  {
    key: "resource_efficiency",
    label: "Resource Fit",
    keywords: [
      "vram", "gpu", "memory", "model_size", "parameters", "quantization",
      "disk", "storage", "hardware_requirement",
    ],
    codeOnlyKeywords: ["gpu", "memory", "storage", "disk", "parameters"],
  },
];

/**
 * Archetype prior weights — used when repo evidence is thin, blended 50/50
 * with evidence-derived weights otherwise. Each row Σ = 1.
 */
export const ARCHETYPE_PRIORS: Record<JudgeKind, Record<string, number>> = {
  latency_race: {
    response_speed: 0.55,
    availability: 0.15,
    response_quality: 0.15,
    throughput: 0.1,
    price: 0.05,
    resource_efficiency: 0.0,
  },
  quality_judge: {
    response_quality: 0.55,
    response_speed: 0.15,
    availability: 0.1,
    throughput: 0.1,
    resource_efficiency: 0.05,
    price: 0.05,
  },
  market_clearing: {
    price: 0.45,
    throughput: 0.25,
    response_speed: 0.15,
    availability: 0.1,
    response_quality: 0.05,
    resource_efficiency: 0.0,
  },
  uptime_sla: {
    availability: 0.5,
    response_speed: 0.2,
    response_quality: 0.1,
    throughput: 0.1,
    resource_efficiency: 0.05,
    price: 0.05,
  },
  resource_fit: {
    resource_efficiency: 0.45,
    throughput: 0.2,
    availability: 0.15,
    response_speed: 0.1,
    response_quality: 0.05,
    price: 0.05,
  },
  unknown: {
    response_speed: 0.2,
    response_quality: 0.2,
    availability: 0.15,
    throughput: 0.15,
    price: 0.15,
    resource_efficiency: 0.15,
  },
};

/** Cohort telemetry — how brutally this subnet's judge distributes incentive. */
export interface JudgeCohort {
  registeredUids: number;
  earningUids: number;
  /** earningUids / registeredUids (0-1). */
  earningRatio: number;
  /** Median incentive among EARNING uids (0-1). */
  medianIncentive: number;
  /** Mean incentive across all registered uids (0-1). */
  meanIncentive: number;
  /** Share of total incentive captured by the top 10% of earners (0-1). */
  top10Take: number;
  /** 0-100 brutality score. */
  brutality: number;
  /** "forgiving" | "moderate" | "brutal" | "shark_tank" */
  band: "forgiving" | "moderate" | "brutal" | "shark_tank";
}

export interface JudgeSource {
  kind: "validator_code" | "readme" | "tree" | "chain" | "curated";
  url?: string;
  note?: string;
}

/** A full per-subnet judge profile (persisted in JudgeProfile). */
export interface JudgeProfileData {
  netuid: number;
  subnetName: string;
  judgeKind: JudgeKind;
  summary: string;
  dimensions: JudgeDimension[];
  cohort: JudgeCohort;
  confidence: number; // 0-1
  sources: JudgeSource[];
}

/** What the miner brings to the simulation. */
export interface MinerSpec {
  /** End-to-end response latency in ms. */
  latencyMs: number;
  /** Availability 0-100 (e.g. 99.5). */
  uptimePct: number;
  /** Output quality 0-100. */
  qualityPct: number;
  /** Requests/tokens throughput (units/s). */
  throughputTps: number;
  /** Asking price per 1M tokens (USD). */
  pricePerMTokUsd: number;
}

export interface DimensionScore {
  key: string;
  label: string;
  weight: number;
  /** 0-1 raw score on this dimension. */
  score: number;
  /** weight × score — contribution to the composite. */
  contribution: number;
  /** Human note on how the score was derived. */
  note: string;
}

export type Verdict = "strong" | "competitive" | "marginal" | "weak";

export interface SimulationResult {
  netuid: number;
  subnetName: string;
  judgeKind: JudgeKind;
  composite: number; // 0-100
  verdict: Verdict;
  /** Estimated percentile within the current cohort (1-99). */
  percentileEstimate: number;
  /** composite / estimated cohort-median composite. */
  medianMultiple: number;
  dimensionScores: DimensionScore[];
  /** Ranked highest-leverage fixes. */
  recommendations: Recommendation[];
  disclaimer: string;
}

export interface Recommendation {
  dimensionKey: string;
  label: string;
  /** Composite points gained if this dimension reached a "good" level. */
  gain: number;
  text: string;
}
