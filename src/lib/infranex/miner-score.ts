// ---------------------------------------------------------------------------
// Miner's Ledger scoring v2 — models how an experienced GPU miner actually
// picks a subnet. Research-backed (Bittensor docs, taostats miner guide,
// miner-economics deep dives, dTAO analyst frameworks):
//
//   Q1 FIT        — can my hardware run this? (subnet type → GPU tier/cost)
//   Q2 TOP LINE   — what does it pay? (emission × 41% miner share ÷ EARNING
//                   miners, priced in alpha → TAO → USD)
//   Q3 BOTTOM LINE— what do I keep? (minus GPU rental + infra → net monthly)
//   Q4 SEAT SAFETY— can I keep the slot? (saturation, reward concentration,
//                   burn cost, immunity runway)
//   Q5 HOLD VALUE — will revenue persist? (alpha price trend, pool liquidity,
//                   sell-pressure slippage, owner identity, maturity)
//
// Key constants from the chain: per-tempo split is 18% owner / 41% miners /
// 41% validators+stakers. "Top 10-20% of miners take 60-80% of emissions;
// median miners hover near breakeven" — so the ledger scores NET numbers,
// not gross, and treats reward concentration as a first-class risk.
// ---------------------------------------------------------------------------

import type { LiveSubnetMetrics } from "./chain";
import type { OpportunityFactor } from "./types";
import { electricityMonthlyUsd } from "./profitability";

const clampScore = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------
// Score primitives — 5 pillars, miner-first weights
// ---------------------------------------------------------------------------

export interface ScoreComponents {
  /** Net ROI after GPU rental + infra costs (the bottom line). */
  net_roi: number;
  /** Seat safety — free slots, reward spread, burn cost, immunity runway. */
  seat_safety: number;
  /** Alpha economics — 24h price trend, pool liquidity, sell slippage. */
  alpha_economics: number;
  /** Earning reality — rewarded ratio, concentration, newcomer ramp penalty. */
  earning_reality: number;
  /** Fit & feasibility — emission on, validator coverage, identity, maturity. */
  fit_feasibility: number;
}

export const SCORE_WEIGHTS: Record<keyof ScoreComponents, number> = {
  net_roi: 0.3,
  seat_safety: 0.2,
  alpha_economics: 0.2,
  earning_reality: 0.15,
  fit_feasibility: 0.15,
};

const FACTOR_LABELS: Record<keyof ScoreComponents, string> = {
  net_roi: "Net ROI (after GPU cost)",
  seat_safety: "Seat Safety",
  alpha_economics: "Alpha Economics",
  earning_reality: "Earning Reality",
  fit_feasibility: "Fit & Feasibility",
};

const FACTOR_DESC: Record<keyof ScoreComponents, string> = {
  net_roi:
    "Newcomer-adjusted mid-pack monthly USD (per-registered slot × reward spread) minus GPU rental + infra at market rates — the miner's bottom line, not gross emission.",
  seat_safety:
    "Free UID slots, reward spread (top-10% concentration), registration burn level and immunity runway — can you keep the seat?",
  alpha_economics:
    "dTAO hold value: alpha price 24h trend, TAO-side pool depth (exit liquidity) and slippage from converting daily earnings.",
  earning_reality:
    "Share of registered miners actually rewarded, top-10% emission concentration and the bond-EMA ramp penalty for newcomers.",
  fit_feasibility:
    "Emission enabled, validator coverage, on-chain identity/GitHub and subnet maturity — operational basics before committing hardware.",
};

export function deriveFactors(c: ScoreComponents): OpportunityFactor[] {
  return (Object.keys(c) as (keyof ScoreComponents)[]).map((k) => {
    const raw = c[k];
    const weight = SCORE_WEIGHTS[k];
    return {
      name: FACTOR_LABELS[k],
      value: Math.round(raw * weight * 100) / 100,
      weight,
      raw,
      impact: raw >= 60 ? "positive" : raw <= 40 ? "negative" : "neutral",
      description: FACTOR_DESC[k],
    };
  });
}

export function totalScore(c: ScoreComponents): number {
  return Math.round(
    (Object.keys(c) as (keyof ScoreComponents)[]).reduce(
      (acc, k) => acc + c[k] * SCORE_WEIGHTS[k],
      0
    ) * 10
  ) / 10;
}

export function riskLevel(score: number): "low" | "medium" | "high" {
  if (score >= 60) return "low";
  if (score >= 40) return "medium";
  return "high";
}

// ---------------------------------------------------------------------------
// GPU market cost table — 2026 rental rates (Vast/RunPod/Lambda-class).
// What the subnet's WORK TYPE demands drives the cost, not reverse-engineered
// revenue: "VRAM is the binding constraint" (70B @ FP8 ≈ 80GB).
// ---------------------------------------------------------------------------

export interface GpuTier {
  label: string;
  recommendedGpu: string;
  minVramGb: number;
  /** Monthly all-in rental at market rate (or power for owned-equivalent). */
  monthlyRentUsd: number;
  /** GPU board power draw in watts — drives the owned-hardware electricity line. */
  powerWatts: number;
}

export const GPU_TIERS = {
  h200: { label: "H200-class", recommendedGpu: "H200 141GB", minVramGb: 141, monthlyRentUsd: 2500, powerWatts: 700 },
  h100: { label: "H100-class", recommendedGpu: "H100 80GB", minVramGb: 80, monthlyRentUsd: 1700, powerWatts: 700 },
  a100: { label: "A100-class", recommendedGpu: "A100 80GB", minVramGb: 80, monthlyRentUsd: 950, powerWatts: 400 },
  a6000: { label: "A6000-class", recommendedGpu: "RTX A6000 48GB", minVramGb: 48, monthlyRentUsd: 320, powerWatts: 300 },
  consumer24: { label: "Consumer 24GB", recommendedGpu: "RTX 4090 24GB", minVramGb: 24, monthlyRentUsd: 260, powerWatts: 450 },
  vram16: { label: "Consumer 16GB", recommendedGpu: "RTX 4060 Ti 16GB", minVramGb: 16, monthlyRentUsd: 150, powerWatts: 160 },
  entry: { label: "Entry GPU", recommendedGpu: "Entry GPU 8GB", minVramGb: 8, monthlyRentUsd: 80, powerWatts: 100 },
  cpu: { label: "CPU-only", recommendedGpu: "CPU VPS", minVramGb: 0, monthlyRentUsd: 50, powerWatts: 20 },
} as const satisfies Record<string, GpuTier>;

/** Infra cost on top of the GPU: VPS, monitoring, alerting. Scraping adds proxies. */
const INFRA_BASE_USD = 40;
const INFRA_SCRAPER_USD = 120; // + residential proxies

// ---------------------------------------------------------------------------
// Subnet work-type classifier — maps name/description keywords to the
// hardware profile a miner would read off the subnet's min_compute.yml.
// ---------------------------------------------------------------------------

export interface SubnetHardwareProfile {
  /** Human-readable work type, e.g. "Frontier inference". */
  category: string;
  tier: GpuTier;
  minVramGb: number;
  recommendedGpu: string;
  monthlyCostUsd: number;
  isGpuWorkload: boolean;
  /** True when keywords matched a known work type (vs revenue fallback). */
  classified: boolean;
}

/** Deterministic GPU tier from the reward stream — fallback for subnets
 *  with no registered identity. What per-miner revenue can plausibly fund. */
export function estimateGpuTierFromRevenue(monthlyUsdPerMiner: number): GpuTier {
  if (monthlyUsdPerMiner >= 1200) return GPU_TIERS.h200;
  if (monthlyUsdPerMiner >= 600) return GPU_TIERS.h100;
  if (monthlyUsdPerMiner >= 300) return GPU_TIERS.a100;
  if (monthlyUsdPerMiner >= 140) return GPU_TIERS.a6000;
  if (monthlyUsdPerMiner >= 60) return GPU_TIERS.consumer24;
  if (monthlyUsdPerMiner >= 25) return GPU_TIERS.vram16;
  if (monthlyUsdPerMiner >= 8) return GPU_TIERS.entry;
  return GPU_TIERS.cpu;
}

interface CategoryRule {
  keywords: RegExp;
  category: string;
  tier: GpuTier;
  infra?: number;
}

// Ordered — first match wins. Derived from how subnet teams describe their
// incentive mechanism (on-chain SubnetIdentitiesV3 descriptions).
const CATEGORY_RULES: CategoryRule[] = [
  { keywords: /\b(frontier|llm|text.?gen|prompt|language model|chat|assistant|inference)\b/i, category: "Frontier inference", tier: GPU_TIERS.h100 },
  { keywords: /\b(pretrain|pre-train|model training|training network|grpo|rlhf|post.?training)\b/i, category: "Model training", tier: GPU_TIERS.h200 },
  { keywords: /\b(video|image|diffusion|vision|photo|generative media|3d|render)\b/i, category: "Media generation", tier: GPU_TIERS.consumer24 },
  { keywords: /\b(audio|speech|voice|music|sound)\b/i, category: "Audio & speech", tier: GPU_TIERS.consumer24 },
  { keywords: /\b(scrap|crawl|data collect|data index|social data|sentiment|feed|dataset)\b/i, category: "Data & scraping", tier: GPU_TIERS.cpu, infra: INFRA_SCRAPER_USD },
  { keywords: /\b(storag|file|archiv|backup)\b/i, category: "Storage", tier: GPU_TIERS.cpu },
  { keywords: /\b(prediction|market mak|trading|financ|quant|hedge|odds)\b/i, category: "Prediction & markets", tier: GPU_TIERS.cpu },
  { keywords: /\b(agent|orchestrat|routing|logic|swarm|tool use|evm|smart contract|web3 infra)\b/i, category: "Agents & logic", tier: GPU_TIERS.cpu },
  { keywords: /\b(protein|fold|bio|genom|drug|science|research|simulat)\b/i, category: "Science & simulation", tier: GPU_TIERS.a6000 },
  { keywords: /\b(compute|gpu|depin|edge|latency|bandwidth|network shar)\b/i, category: "Compute sharing", tier: GPU_TIERS.consumer24 },
  { keywords: /\b(moderat|detect|scan|verif|audit|secur|privacy|zero.?know)\b/i, category: "Verification & security", tier: GPU_TIERS.consumer24 },
  { keywords: /\b(maps?|geo|weather|energy|robot|drone|iot)\b/i, category: "Real-world data", tier: GPU_TIERS.consumer24 },
];

export function classifySubnetHardware(
  name: string | null | undefined,
  description: string | null | undefined,
  fallbacks?: {
    /** Curated category text (e.g. "Inference") when the chain identity is absent. */
    fallbackCategory?: string;
    /** Curated/user GPU figures win when the classifier has no keyword match. */
    fallbackVramGb?: number;
    fallbackGpu?: string;
    /** Per-earning-miner monthly USD — revenue-based fallback tier. */
    fallbackMonthlyUsd?: number;
  }
): SubnetHardwareProfile {
  const text = `${name ?? ""} ${description ?? ""} ${fallbacks?.fallbackCategory ?? ""}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.test(text)) {
      return {
        category: rule.category,
        tier: rule.tier,
        minVramGb: rule.tier.minVramGb,
        recommendedGpu: rule.tier.recommendedGpu,
        monthlyCostUsd: rule.tier.monthlyRentUsd + (rule.infra ?? INFRA_BASE_USD),
        isGpuWorkload: rule.tier.minVramGb > 0,
        classified: true,
      };
    }
  }
  // No keyword match — fall back to curated VRAM data, else revenue tier.
  if (fallbacks?.fallbackVramGb && fallbacks.fallbackVramGb > 0) {
    const tier = Object.values(GPU_TIERS).find(
      (t) => t.minVramGb === fallbacks.fallbackVramGb
    ) ?? GPU_TIERS.consumer24;
    return {
      category: fallbacks.fallbackCategory || "Unclassified workload",
      tier,
      minVramGb: tier.minVramGb,
      recommendedGpu: fallbacks.fallbackGpu ?? tier.recommendedGpu,
      monthlyCostUsd: tier.monthlyRentUsd + INFRA_BASE_USD,
      isGpuWorkload: true,
      classified: false,
    };
  }
  const tier = estimateGpuTierFromRevenue(fallbacks?.fallbackMonthlyUsd ?? 0);
  return {
    category: fallbacks?.fallbackCategory || "Unclassified workload",
    tier,
    minVramGb: tier.minVramGb,
    recommendedGpu: tier.recommendedGpu,
    monthlyCostUsd: tier.monthlyRentUsd + INFRA_BASE_USD,
    isGpuWorkload: tier.minVramGb > 0,
    classified: false,
  };
}

// ---------------------------------------------------------------------------
// The ledger — per-miner economics + 5-pillar scoring, uniform for ALL subnets
// ---------------------------------------------------------------------------

export interface MinerLedgerDiagnostics {
  // Top line (per-EARNING-miner economics)
  /** Mean over rewarded UIDs — the upside reference (what current earners get). */
  perEarningDailyTao: number;
  /** Newcomer-adjusted mid-pack revenue: per-registered slot × median share.
   *  The miner-mindset number: "if I register today, what does a mid-pack seat pay?" */
  expectedDailyTao: number;
  rewardMedianShare: number | null;
  perRegisteredDailyTao: number;
  grossMonthlyUsd: number;
  // Alpha conversion
  alphaPriceTao: number;
  alphaPriceUsd: number;
  alphaChange24h: number | null;
  liquidityTao: number;
  slippagePct: number | null;
  // Bottom line
  category: string;
  gpuLabel: string;
  recommendedGpu: string;
  minVramGb: number;
  gpuPowerWatts: number;
  gpuCostMonthlyUsd: number;
  infraCostMonthlyUsd: number;
  storageCostMonthlyUsd: number;
  otherOpexMonthlyUsd: number;
  amortizedBurnUsd: number;
  totalCostMonthlyUsd: number;
  netMonthlyUsd: number;
  netDailyTao: number;
  // Seat
  freeSlots: number | null;
  totalSlots: number | null;
  rewardedRatio: number | null;
  top10IncentiveShare: number | null;
  burnCostTao: number | null;
  immunityBlocks: number | null;
  rampWeeks: number | null;
  // Meta
  emissionEnabled: boolean;
  hardwareClassified: boolean;
}

export interface MinerLedger {
  components: ScoreComponents;
  factors: OpportunityFactor[];
  diag: MinerLedgerDiagnostics;
}

/**
 * Score one subnet the way a miner reads it. Deterministic per snapshot —
 * the same inputs always produce the same score so ranks stay stable.
 */
export function scoreMinersLedger(inputs: {
  live: LiveSubnetMetrics;
  taoUsd: number;
  hardware?: SubnetHardwareProfile | null;
  taoChange24h?: number;
  /** Blocks since the subnet was registered (for the maturity bonus). */
  liveAgeBlocks?: number | null;
  /** User-configurable cost lines (Profitability Engine settings). When
   *  absent, market defaults apply — same engine, same shape. */
  costs?: {
    hardwareMode?: "rent" | "owned";
    electricityUsdPerKwh?: number;
    storageMonthlyUsd?: number;
    /** 0/undefined = auto infra from the work-type classifier. */
    infraMonthlyUsd?: number;
    otherOpexMonthlyUsd?: number;
    includeBurnAmortization?: boolean;
    amortizeBurnMonths?: number;
  };
}): MinerLedger {
  const { live, taoUsd } = inputs;
  const usd = taoUsd || 0;

  // --- Top line: newcomer-adjusted per-miner revenue ----------------------
  // Miners get 41% of the subnet's emission (docs constant); the chain-
  // measured minerEmissionTaoPerDay already reflects the realized split.
  //
  // The decision a miner makes is "if I register TODAY, what does a
  // mid-pack seat pay?" — so the ledger starts from the per-REGISTERED
  // slot (zero-earning seats included: on many subnets 250+ UIDs are
  // registered and only a handful earn), then applies the median/mean
  // spread share so a whale UID can't inflate the estimate.
  // perEarningDailyTao (mean over rewarded UIDs) is kept as the upside
  // reference — what current earners make.
  const rewarded = Math.max(live.rewardedMiners ?? 0, 0);
  const registered = Math.max(live.minersCount, 1);
  const minerEmissionTaoPerDay = live.minerEmissionTaoPerDay ?? 0;
  const perRegisteredDailyTao =
    minerEmissionTaoPerDay > 0 ? minerEmissionTaoPerDay / registered : 0;
  const perEarningDailyTao =
    rewarded > 0 && minerEmissionTaoPerDay > 0
      ? minerEmissionTaoPerDay / rewarded
      : minerEmissionTaoPerDay > 0
        ? perRegisteredDailyTao // vec unavailable — no zero-slot discount available
        : 0;
  const rewardMedianShare = live.incentiveMedianShare ?? 1;
  // Newcomer-adjusted mid-pack revenue:
  //  - reward vec available  → perRegistered × medianShare
  //  - reward vec unavailable→ perRegistered × 0.6 (conservative)
  const expectedDailyTao =
    rewarded > 0 && minerEmissionTaoPerDay > 0
      ? perRegisteredDailyTao * rewardMedianShare
      : minerEmissionTaoPerDay > 0
        ? perRegisteredDailyTao * 0.6
        : 0;
  const grossMonthlyUsd = Math.round(expectedDailyTao * 30 * usd);
  const dailyAlpha = live.movingPrice > 0 ? expectedDailyTao / live.movingPrice : 0;

  // --- Hardware profile (work type → GPU cost) ---------------------------
  const fallbackMonthly = grossMonthlyUsd > 0 ? grossMonthlyUsd : undefined;
  const hardware =
    inputs.hardware ??
    classifySubnetHardware(live.name, live.identityDescription, {
      fallbackMonthlyUsd: fallbackMonthly,
    });
  // --- Cost stack (Profitability Engine lines) ----------------------------
  const costs = inputs.costs ?? {};
  const gpuCost =
    costs.hardwareMode === "owned"
      ? electricityMonthlyUsd(
          hardware.tier.powerWatts,
          costs.electricityUsdPerKwh ?? 0.12
        )
      : hardware.tier.monthlyRentUsd;
  const infraCost =
    costs.infraMonthlyUsd != null && costs.infraMonthlyUsd > 0
      ? costs.infraMonthlyUsd
      : Math.max(hardware.monthlyCostUsd - hardware.tier.monthlyRentUsd, INFRA_BASE_USD);
  const storageCost = costs.storageMonthlyUsd ?? 0;
  const otherOpex = costs.otherOpexMonthlyUsd ?? 0;
  const burnUsd =
    live.burnCostTao != null && costs.includeBurnAmortization
      ? Math.max(live.burnCostTao, 0) * usd
      : 0;
  const amortizedBurn = burnUsd / Math.max(costs.amortizeBurnMonths ?? 3, 1);
  const totalCosts = gpuCost + infraCost + storageCost + otherOpex + amortizedBurn;
  // Zero-revenue subnets are honest losers: the cost stack still applies.
  const netMonthlyUsd = grossMonthlyUsd > 0
    ? Math.round(grossMonthlyUsd - totalCosts)
    : -Math.round(totalCosts);

  // --- Alpha economics ----------------------------------------------------
  const alphaPriceTao = live.movingPrice;
  const alphaPriceUsd = alphaPriceTao * usd;
  const liquidityTao = live.subnetTao; // TAO side of the pool = exit liquidity
  const slippagePct =
    live.alphaOut > 0 && dailyAlpha > 0
      ? Math.round((dailyAlpha / live.alphaOut) * 10000) / 100
      : null;

  // --- Seat safety inputs -------------------------------------------------
  const maxUids = live.maxUids ?? 0;
  const freeSlots = maxUids > 0 ? Math.max(0, maxUids - live.minersCount) : null;
  const totalSlots = maxUids > 0 ? maxUids : null;
  const rewardedRatio = live.rewardedMiners != null && live.rewardedMiners > 0
    ? Math.min(1, live.rewardedMiners / registered)
    : live.rewardedMiners === 0
      ? 0
      : null;
  const top10 = live.top10IncentiveShare;

  // Newcomer ramp: bonds build via EMA (α=0.1), and on concentrated subnets
  // a fresh UID starts at zero. Research: 1-3 months of tuning is typical.
  const rampWeeks =
    3 +
    (rewardedRatio != null ? (1 - rewardedRatio) * 6 : 3) +
    (top10 != null && top10 > 0.7 ? 3 : 0) +
    (freeSlots != null && freeSlots === 0 ? 2 : 0);

  // --- Pillar 1: Net ROI --------------------------------------------------
  // $0 → 10, +$100 → 54, +$500 → 69, +$1k → 76, +$5k → 92; losses slide to 2.
  const netRoi =
    netMonthlyUsd >= 0
      ? clampScore(10 + 22 * Math.log10(netMonthlyUsd + 1), 2, 97)
      : clampScore(10 + netMonthlyUsd / 100, 2, 10);

  // --- Pillar 2: Seat safety ----------------------------------------------
  const roomRatio = maxUids > 0 ? freeSlots! / maxUids : 0.5;
  const scoreRoom = clampScore(10 + roomRatio * 45, 10, 55); // full subnet → 10
  const scoreSpread =
    top10 != null ? clampScore(100 - (top10 - 0.2) * 100, 10, 95) : 50;
  const scoreBurn =
    live.burnCostTao != null
      ? clampScore(95 - Math.log10(live.burnCostTao + 1) * 25, 30, 95)
      : 55;
  const scoreImmunity =
    live.immunityBlocks != null
      ? clampScore(30 + (live.immunityBlocks / 7200) * 50, 30, 80)
      : 45;
  const seatSafety = !live.emissionEnabled
    ? 12
    : clampScore(
        scoreRoom * 0.35 + scoreSpread * 0.35 + scoreBurn * 0.15 + scoreImmunity * 0.15,
        5,
        96
      );

  // --- Pillar 3: Alpha economics -------------------------------------------
  const change = live.alphaPriceChange24h;
  const scoreTrend = change != null ? clampScore(50 + change * 1.5, 10, 95) : 50;
  const scoreLiq =
    liquidityTao > 0
      ? clampScore(20 + 19 * Math.log10(liquidityTao / 500 + 1), 10, 95)
      : 10;
  const scoreSlip =
    slippagePct != null ? clampScore(95 - slippagePct * 1200, 15, 95) : 50;
  const alphaEconomics = usd <= 0
    ? 50
    : clampScore(scoreTrend * 0.4 + scoreLiq * 0.3 + scoreSlip * 0.3, 5, 96);

  // --- Pillar 4: Earning reality -------------------------------------------
  const scoreRewarded =
    rewardedRatio != null ? clampScore(15 + rewardedRatio * 70, 15, 85) : 50;
  const scoreConc =
    top10 != null ? clampScore(100 - (top10 - 0.2) * 90, 15, 92) : 50;
  const scoreRamp = clampScore(90 - rampWeeks * 5, 20, 90);
  const earningReality = !live.emissionEnabled
    ? 8
    : clampScore(scoreRewarded * 0.4 + scoreConc * 0.3 + scoreRamp * 0.3, 5, 96);

  // --- Pillar 5: Fit & feasibility ------------------------------------------
  let fitFeasibility = 25; // emission disabled base
  if (live.emissionEnabled) {
    fitFeasibility = 40;
    const validators = live.validatorsCount ?? 0;
    fitFeasibility += clampScore(validators * 2.5, 0, 20); // validator coverage
    if (live.identityGithub) fitFeasibility += 12;
    if (live.identityDescription) fitFeasibility += 6;
    if (live.registeredAt != null && inputs.liveAgeBlocks != null) {
      const ageDays = inputs.liveAgeBlocks / 7200;
      fitFeasibility += clampScore(Math.min(ageDays / 30, 1) * 12, 0, 12); // maturity
    }
    if (live.immunityBlocks != null && live.immunityBlocks < 4096) fitFeasibility -= 5;
  }
  fitFeasibility = clampScore(fitFeasibility, 5, 92);

  const components: ScoreComponents = {
    net_roi: Math.round(netRoi * 10) / 10,
    seat_safety: Math.round(seatSafety * 10) / 10,
    alpha_economics: Math.round(alphaEconomics * 10) / 10,
    earning_reality: Math.round(earningReality * 10) / 10,
    fit_feasibility: Math.round(fitFeasibility * 10) / 10,
  };

  const diag: MinerLedgerDiagnostics = {
    perEarningDailyTao: Math.round(perEarningDailyTao * 10000) / 10000,
    expectedDailyTao: Math.round(expectedDailyTao * 10000) / 10000,
    rewardMedianShare: live.incentiveMedianShare,
    perRegisteredDailyTao: Math.round(perRegisteredDailyTao * 10000) / 10000,
    grossMonthlyUsd,
    alphaPriceTao,
    alphaPriceUsd: Math.round(alphaPriceUsd * 1000) / 1000,
    alphaChange24h: change ?? null,
    liquidityTao: Math.round(liquidityTao),
    slippagePct,
    category: hardware.category,
    gpuLabel: hardware.tier.label,
    recommendedGpu: hardware.recommendedGpu,
    minVramGb: hardware.minVramGb,
    gpuCostMonthlyUsd: Math.round(gpuCost),
    infraCostMonthlyUsd: Math.round(infraCost),
    storageCostMonthlyUsd: Math.round(storageCost),
    otherOpexMonthlyUsd: Math.round(otherOpex),
    amortizedBurnUsd: Math.round(amortizedBurn),
    totalCostMonthlyUsd: Math.round(totalCosts),
    gpuPowerWatts: hardware.tier.powerWatts,
    netMonthlyUsd,
    netDailyTao:
      usd > 0 ? Math.round((netMonthlyUsd / 30 / usd) * 10000) / 10000 : 0,
    freeSlots,
    totalSlots,
    rewardedRatio: rewardedRatio != null ? Math.round(rewardedRatio * 1000) / 1000 : null,
    top10IncentiveShare: top10,
    burnCostTao: live.burnCostTao,
    immunityBlocks: live.immunityBlocks,
    rampWeeks: Math.round(rampWeeks * 10) / 10,
    emissionEnabled: live.emissionEnabled,
    hardwareClassified: hardware.classified,
  };

  return { components, factors: deriveFactors(components), diag };
}

// ---------------------------------------------------------------------------
// Chance to earn · month 1 — a newcomer's honest odds of earning ANY reward
// during their first month of continuous, good-uptime mining. Uptime alone
// keeps the seat; the share of slots that actually earn decides whether the
// wallet moves. Dominant factor: rewardedRatio (share of registered slots
// that earned last epoch), discounted for whale dominance, full subnets
// (must displace an incumbent) and long bond-EMA ramps.
// ---------------------------------------------------------------------------

export type EarnChanceLevel = "high" | "medium" | "low" | "none";

export interface EarnChance {
  level: EarnChanceLevel;
  /** 0–100 modeled chance that a newcomer earns something in month 1. */
  pct: number;
  /** Human explanation of the dominant factors. */
  note: string;
}

export function computeEarnChance(inputs: {
  /** Share of registered slots that earned reward last epoch (0..1). */
  rewardedRatio: number | null;
  /** Free UID slots (null = unknown). 0 means you must displace an incumbent. */
  freeSlots: number | null;
  /** Top-10% share of epoch incentive (0..1) — whale dominance. */
  top10IncentiveShare: number | null;
  /** Newcomer bond-EMA ramp estimate in weeks. */
  rampWeeks: number | null;
}): EarnChance {
  const { rewardedRatio, freeSlots, top10IncentiveShare, rampWeeks } = inputs;

  // Base: the fraction of slots that actually earn — the single strongest
  // predictor of whether a newcomer earns anything at all.
  let pct = rewardedRatio != null ? rewardedRatio * 100 : 0;
  const factors: string[] = [];

  // Whale dominance: when the top 10% of UIDs take nearly everything, the
  // rewarded tail is scraps — being "rewarded" still pays almost nothing.
  if (top10IncentiveShare != null && top10IncentiveShare > 0.5) {
    pct *= 1 - Math.min(1, top10IncentiveShare - 0.5) * 0.6;
    factors.push(
      `top-10% of UIDs take ${Math.round(top10IncentiveShare * 100)}% of rewards`
    );
  }

  // Full subnet: no free seats — you must outperform an incumbent to get in,
  // and you start from zero bonds against their established ones.
  if (freeSlots === 0) {
    pct *= 0.7;
    factors.push("subnet full — must displace an incumbent");
  }

  // Long ramp: month 1 is mostly bond-building; long ramps leave little of it.
  if (rampWeeks != null && rampWeeks > 8) {
    pct *= 0.8;
    factors.push(`~${Math.round(rampWeeks)} wk ramp to full bonds`);
  }

  pct = Math.round(Math.max(0, Math.min(100, pct)));
  const level: EarnChanceLevel =
    rewardedRatio != null && rewardedRatio <= 0
      ? "none"
      : pct >= 50
        ? "high"
        : pct >= 20
          ? "medium"
          : pct > 0
            ? "low"
            : "none";

  const base = rewardedRatio != null
    ? `${rewardedRatio < 0.1 && rewardedRatio > 0 ? (rewardedRatio * 100).toFixed(1) : Math.round(rewardedRatio * 100)}% of slots earned last epoch`
    : "reward spread unknown";
  const note =
    factors.length > 0 ? `${base} · ${factors.join(" · ")}` : base;

  return { level, pct, note };
}

// ---------------------------------------------------------------------------
// Seat Chance — "can I actually GET IN?" (vs EarnChance's "will I earn?").
//
// Bittensor registration mechanics:
//   • Subnets have a UID cap (maxUids). Free slots → register via burn or PoW.
//   • FULL subnet → registration STILL works: a burn registration pays the
//     dynamic recycle cost and the chain replaces the worst-performing
//     NON-IMMUNE uid. PoW registrations compete for per-block slots the same
//     way. You are only locked out if every uid is immune (rare — immunity
//     covers ~14h by default) or registration is disabled on the subnet.
//   • immunityBlocks = how long YOUR new seat cannot be deregistered — the
//     runway to start earning before becoming replaceable yourself.
// ---------------------------------------------------------------------------

/**
 * Burn-quote display precision — the chain's burn hyperparam can sit at the
 * floor (e.g. Chutes ~0.0005 TAO); 3 decimals would show "0.001" — a 2x
 * misquote shown to a user deciding whether to burn. <0.01 → 4 decimals,
 * <1 → 3, else 2.
 */
export function formatBurnTao(n: number): string {
  if (n < 0.01) return n.toFixed(4);
  if (n < 1) return n.toFixed(3);
  return n.toFixed(2);
}

export type SeatVerdict = "open" | "burn-entry" | "waitlist" | "unknown";

export interface SeatChance {
  verdict: SeatVerdict;
  /** Registration is possible right now (burn path or free slot). */
  canRegister: boolean;
  slotsFree: number | null;
  totalSlots: number | null;
  /** 0–100 — how full the uid space is. */
  fillPct: number | null;
  burnCostTao: number | null;
  /** Protection window for a NEW seat, in hours (blocks × 12s). */
  immunityHours: number | null;
  /** Share of uids that earned NOTHING last epoch — the replaceable bottom
   *  a newcomer displaces from. High = churn churns in your favor. */
  replaceableShare: number | null;
  headline: string;
  detail: string;
}

export function assessSeatChance(inputs: {
  minersCount: number | null;
  maxUids: number | null;
  /** Already-computed free slots (skip when you only have counts). */
  freeSlots?: number | null;
  burnCostTao: number | null;
  immunityBlocks: number | null;
  /** Rewarded uids (either give the ratio directly or the absolute count). */
  rewardedRatio?: number | null;
  rewardedMiners?: number | null;
}): SeatChance {
  const { maxUids, burnCostTao, immunityBlocks } = inputs;
  const minersCount = inputs.minersCount ?? 0;
  const slotsFree =
    inputs.freeSlots != null
      ? Math.max(0, inputs.freeSlots)
      : maxUids != null && maxUids > 0
        ? Math.max(0, maxUids - minersCount)
        : null;
  const fillPct =
    maxUids != null && maxUids > 0
      ? Math.min(100, Math.round((minersCount / maxUids) * 100))
      : null;
  let replaceableShare: number | null = null;
  if (inputs.rewardedRatio != null) {
    replaceableShare = Math.max(0, Math.min(1, 1 - inputs.rewardedRatio));
  } else if (inputs.rewardedMiners != null && minersCount > 0) {
    replaceableShare = Math.max(0, Math.min(1, 1 - inputs.rewardedMiners / minersCount));
  }
  const immunityHours =
    immunityBlocks != null && immunityBlocks > 0
      ? Math.round(((immunityBlocks * 12) / 3600) * 10) / 10
      : null;
  const immunityNote = immunityHours != null
    ? `a new seat is immune for ~${immunityHours}h — your runway to start earning before you're replaceable`
    : null;
  const deadNote = replaceableShare != null && replaceableShare > 0.05
    ? `${Math.round(replaceableShare * 100)}% of uids earned nothing last epoch — a deep replaceable bottom`
    : replaceableShare != null
      ? "almost every seat earned last epoch — displacement targets are scarce and strong"
      : null;

  const unknown: SeatChance = {
    verdict: "unknown",
    canRegister: true,
    slotsFree,
    totalSlots: maxUids ?? null,
    fillPct,
    burnCostTao,
    immunityHours,
    replaceableShare,
    headline: "slot data unavailable",
    detail:
      "UID capacity was not returned by the chain snapshot this pass — refresh the network data. " +
      (burnCostTao != null ? `Burn registration quote: ~${formatBurnTao(burnCostTao)} TAO.` : ""),
  };

  if (slotsFree == null || maxUids == null || maxUids <= 0) return unknown;

  // --- Open: free slots exist ---------------------------------------------
  if (slotsFree > 0) {
    return {
      verdict: "open",
      canRegister: true,
      slotsFree,
      totalSlots: maxUids,
      fillPct,
      burnCostTao,
      immunityHours,
      replaceableShare,
      headline: `${slotsFree} of ${maxUids} slots free`,
      detail:
        `This subnet is NOT full — ${slotsFree} uid${slotsFree === 1 ? "" : "s"} open (${fillPct}% filled). ` +
        `Register now via burn${burnCostTao != null ? ` (~${formatBurnTao(burnCostTao)} TAO)` : ""} or PoW. ` +
        (immunityNote ? `${immunityNote}. ` : "") +
        (deadNote ? `${deadNote}.` : ""),
    };
  }

  // --- Full: burn-entry is the deterministic path ---------------------------
  if (burnCostTao != null && burnCostTao > 0) {
    return {
      verdict: "burn-entry",
      canRegister: true,
      slotsFree: 0,
      totalSlots: maxUids,
      fillPct,
      burnCostTao,
      immunityHours,
      replaceableShare,
      headline: `full (${minersCount}/${maxUids}) — burn-entry ~${formatBurnTao(burnCostTao)} TAO`,
      detail:
        `Every uid is taken, but registration still works: paying the burn (~${formatBurnTao(burnCostTao)} TAO, floats with demand) ` +
        `immediately replaces the WORST-performing non-immune uid. ` +
        (deadNote ? `${deadNote}. ` : "The bottom of this cohort is well-defended — displacement may take several attempts. ") +
        (immunityNote ? `${immunityNote}.` : ""),
    };
  }

  // --- Full, no burn quote: PoW/competitive path ----------------------------
  return {
    verdict: "waitlist",
    canRegister: true,
    slotsFree: 0,
    totalSlots: maxUids,
    fillPct,
    burnCostTao: null,
    immunityHours,
    replaceableShare,
    headline: `full (${minersCount}/${maxUids}) — entry is competitive`,
    detail:
      `No free slots and no burn quote from this snapshot. Entry means winning a PoW registration ` +
      `and replacing a zero-earning uid — expect per-block competition. ` +
      (deadNote ? `${deadNote}. ` : "") +
      (immunityNote ? `${immunityNote}.` : ""),
  };
}
