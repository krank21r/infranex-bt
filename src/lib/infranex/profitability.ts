// ---------------------------------------------------------------------------
// Profitability Engine — the miner's P&L statement, per subnet.
//
//   Expected Revenue
//     − GPU Rental
//     − Storage
//     − Infrastructure
//     − Other operating costs
//     = NET PROFIT
//
// then derives: ROI, daily / weekly / monthly profit, break-even, profit
// margin and risk-adjusted profit — and enforces the MINIMUM ENTRY RULE:
//
//     NET PROFIT < minNetProfitTargetUsd  →  AVOID
//
// Every number a business would ask for before renting the GPU. The target
// and every cost line are CONFIGURABLE (persisted server-side via
// /api/profitability-config) — nothing is buried in code.
// ---------------------------------------------------------------------------

import type { ScoreComponents } from "./miner-score";

// ---------------------------------------------------------------------------
// Configuration — persisted in SQLite (ProfitabilitySettings singleton),
// editable from the UI, with sane market defaults.
// ---------------------------------------------------------------------------

export interface ProfitabilityConfig {
  /** MINIMUM ENTRY RULE: net profit below this monthly USD → AVOID. */
  minNetProfitTargetUsd: number;
  /** Storage line: NVMe volume / disk for models, logs, datasets ($/mo). */
  storageMonthlyUsd: number;
  /** Infrastructure line: VPS, monitoring, alerting ($/mo). 0 = auto by work
   *  type (base 40, scraping 120 for proxies). */
  infraMonthlyUsd: number;
  /** Other operating costs: bandwidth overage, top-up fees, misc ($/mo). */
  otherOpexMonthlyUsd: number;
  /** rent = pay market GPU rental (tier rate); owned = electricity model. */
  hardwareMode: "rent" | "owned";
  /** Electricity price for owned hardware ($/kWh). */
  electricityUsdPerKwh: number;
  /** Count the registration burn as an upfront cost (amortized). */
  includeRegistrationBurn: boolean;
  /** Months over which the registration burn is amortized. */
  amortizeBurnMonths: number;
  /** Apply the seat/alpha/earning risk factor to net profit. */
  riskAdjustment: boolean;
}

export const DEFAULT_PROFITABILITY_CONFIG: ProfitabilityConfig = {
  minNetProfitTargetUsd: 300,
  storageMonthlyUsd: 15,
  infraMonthlyUsd: 0, // 0 = auto by work type
  otherOpexMonthlyUsd: 25,
  hardwareMode: "rent",
  electricityUsdPerKwh: 0.12,
  includeRegistrationBurn: true,
  amortizeBurnMonths: 3,
  riskAdjustment: true,
};

/** Defensive parse of untrusted JSON (API body / DB row) → valid config. */
export function sanitizeProfitabilityConfig(raw: unknown): ProfitabilityConfig {
  const d = DEFAULT_PROFITABILITY_CONFIG;
  if (raw == null || typeof raw !== "object") return { ...d };
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = typeof v === "string" ? Number(v) : v;
    return typeof n === "number" && Number.isFinite(n)
      ? Math.min(max, Math.max(min, n))
      : fallback;
  };
  return {
    minNetProfitTargetUsd: num(r.minNetProfitTargetUsd, d.minNetProfitTargetUsd, 0, 1_000_000),
    storageMonthlyUsd: num(r.storageMonthlyUsd, d.storageMonthlyUsd, 0, 100_000),
    infraMonthlyUsd: num(r.infraMonthlyUsd, d.infraMonthlyUsd, 0, 100_000),
    otherOpexMonthlyUsd: num(r.otherOpexMonthlyUsd, d.otherOpexMonthlyUsd, 0, 100_000),
    hardwareMode: r.hardwareMode === "owned" ? "owned" : "rent",
    electricityUsdPerKwh: num(r.electricityUsdPerKwh, d.electricityUsdPerKwh, 0, 10),
    includeRegistrationBurn:
      typeof r.includeRegistrationBurn === "boolean"
        ? r.includeRegistrationBurn
        : d.includeRegistrationBurn,
    amortizeBurnMonths: Math.round(num(r.amortizeBurnMonths, d.amortizeBurnMonths, 1, 36)),
    riskAdjustment:
      typeof r.riskAdjustment === "boolean" ? r.riskAdjustment : d.riskAdjustment,
  };
}

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

export type ProfitVerdict = "PROFITABLE" | "MARGINAL" | "AVOID";

export interface ProfitabilityReport {
  // --- P&L waterfall (monthly USD) ---
  expectedRevenueUsd: number;
  gpuRentalUsd: number;
  storageUsd: number;
  infrastructureUsd: number;
  otherOperatingUsd: number;
  /** otherOperating + amortized registration burn (what "Other" sums to). */
  otherOperatingTotalUsd: number;
  /** Amortized registration burn inside Other (0 when disabled). */
  amortizedBurnUsd: number;
  /** GPU Rental + Storage + Infrastructure + Other operating. */
  totalCostsUsd: number;
  // --- NET PROFIT ---
  netMonthlyUsd: number;
  netWeeklyUsd: number;
  netDailyUsd: number;
  // --- Derived metrics ---
  /** Net profit ÷ total operating cost, monthly %. */
  roiMonthlyPct: number;
  /** ROI compounded ×12 (simple annualization). */
  roiAnnualPct: number;
  /** Days to recover upfront capital (burn + first-month costs), incl. ramp. */
  breakEvenDays: number | null;
  /** Net ÷ revenue, %. */
  profitMarginPct: number;
  /** Net × (1 − risk factor) — what the P&L looks like after seat/alpha risk. */
  riskAdjustedMonthlyUsd: number;
  /** 0–0.6 — the haircut applied from seat/alpha/earning risk pillars. */
  riskFactor: number;
  // --- Minimum entry rule ---
  targetUsd: number;
  meetsMinimum: boolean;
  /** How far below the target the net profit is (0 when it passes). */
  shortfallUsd: number;
  verdict: ProfitVerdict;
}

// ---------------------------------------------------------------------------
// Risk factor — from the three risk-bearing pillars of the Miner's Ledger.
// A subnet can have great paper economics but a knife-fight seat or a dying
// alpha price; the risk-adjusted line discounts for that.
// ---------------------------------------------------------------------------

export function computeRiskFactor(c: ScoreComponents): number {
  const composite =
    c.seat_safety * 0.4 + c.alpha_economics * 0.3 + c.earning_reality * 0.3;
  // composite 90+ → ~0.1 haircut; composite 50 → 0.35; composite 20 → capped 0.6
  return Math.min(0.6, Math.max(0.05, 1 - composite / 100));
}

// ---------------------------------------------------------------------------
// Owned-hardware electricity: GPU draw + ~150 W host (CPU/RAM/network).
// ---------------------------------------------------------------------------

export function electricityMonthlyUsd(
  powerWatts: number,
  usdPerKwh: number
): number {
  const kw = (Math.max(powerWatts, 0) + 150) / 1000;
  return kw * 24 * 30 * usdPerKwh;
}

// ---------------------------------------------------------------------------
// The engine — takes the Miner's Ledger outputs for one subnet plus the
// user's config and produces the full P&L report.
// ---------------------------------------------------------------------------

export interface ProfitabilityInputs {
  /** Expected revenue (newcomer mid-pack monthly USD) from the ledger. */
  grossMonthlyUsd: number;
  /** Market GPU rental for the work type's tier ($/mo). */
  gpuRentMonthlyUsd: number;
  /** Tier power draw in W (for owned-hardware electricity mode). */
  gpuPowerWatts: number;
  /** Auto infra from the work-type classifier ($/mo) — used when config.infraMonthlyUsd is 0. */
  autoInfraMonthlyUsd: number;
  /** Registration burn in TAO (upfront seat cost), null when unknown. */
  burnCostTao: number | null;
  /** Newcomer ramp estimate in weeks (delays first revenue). */
  rampWeeks: number | null;
  /** TAO spot price in USD. */
  taoUsd: number;
  score: ScoreComponents;
  config: ProfitabilityConfig;
}

export function computeProfitabilityReport(
  inputs: ProfitabilityInputs
): ProfitabilityReport {
  const {
    grossMonthlyUsd,
    gpuRentMonthlyUsd,
    gpuPowerWatts,
    autoInfraMonthlyUsd,
    burnCostTao,
    rampWeeks,
    taoUsd,
    score,
    config,
  } = inputs;

  // --- Cost line items -----------------------------------------------------
  const gpuRentalUsd =
    config.hardwareMode === "owned"
      ? electricityMonthlyUsd(gpuPowerWatts, config.electricityUsdPerKwh)
      : gpuRentMonthlyUsd;
  const storageUsd = config.storageMonthlyUsd;
  const infrastructureUsd =
    config.infraMonthlyUsd > 0 ? config.infraMonthlyUsd : autoInfraMonthlyUsd;

  const burnUsd =
    config.includeRegistrationBurn && burnCostTao != null
      ? Math.max(burnCostTao, 0) * taoUsd
      : 0;
  const amortizedBurnUsd = burnUsd / Math.max(config.amortizeBurnMonths, 1);
  const otherOperatingTotalUsd = config.otherOpexMonthlyUsd + amortizedBurnUsd;

  const totalCostsUsd =
    gpuRentalUsd + storageUsd + infrastructureUsd + otherOperatingTotalUsd;

  // --- NET PROFIT ----------------------------------------------------------
  // Zero-revenue subnets are honest losers: you still pay the cost stack.
  const netMonthlyUsd = grossMonthlyUsd > 0
    ? grossMonthlyUsd - totalCostsUsd
    : -totalCostsUsd;
  const netDailyUsd = netMonthlyUsd / 30;
  const netWeeklyUsd = netMonthlyUsd / 30 * 7;

  // --- Derived metrics ------------------------------------------------------
  const roiMonthlyPct =
    totalCostsUsd > 0 ? (netMonthlyUsd / totalCostsUsd) * 100 : 0;

  // Break-even: recover the upfront capital (registration burn + first month
  // of operating costs) out of net daily profit, plus the bond-EMA ramp while
  // a fresh UID earns little. No profit → never breaks even.
  const upfrontCapitalUsd = burnUsd + totalCostsUsd;
  const rampDays = (rampWeeks ?? 0) * 7;
  const breakEvenDays =
    netDailyUsd > 0
      ? Math.ceil(upfrontCapitalUsd / netDailyUsd + rampDays)
      : null;

  const profitMarginPct =
    grossMonthlyUsd > 0 ? (netMonthlyUsd / grossMonthlyUsd) * 100 : 0;

  const riskFactor = computeRiskFactor(score);
  const riskAdjustedMonthlyUsd = config.riskAdjustment
    ? netMonthlyUsd * (1 - riskFactor)
    : netMonthlyUsd;

  // --- Minimum entry rule ---------------------------------------------------
  const meetsMinimum = netMonthlyUsd >= config.minNetProfitTargetUsd;
  const shortfallUsd = Math.max(0, config.minNetProfitTargetUsd - netMonthlyUsd);

  const verdict: ProfitVerdict = !meetsMinimum
    ? "AVOID"
    : profitMarginPct < 15 ||
        (config.riskAdjustment && riskAdjustedMonthlyUsd < config.minNetProfitTargetUsd)
      ? "MARGINAL"
      : "PROFITABLE";

  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    expectedRevenueUsd: r1(grossMonthlyUsd),
    gpuRentalUsd: r1(gpuRentalUsd),
    storageUsd: r1(storageUsd),
    infrastructureUsd: r1(infrastructureUsd),
    otherOperatingUsd: r1(config.otherOpexMonthlyUsd),
    otherOperatingTotalUsd: r1(otherOperatingTotalUsd),
    amortizedBurnUsd: r1(amortizedBurnUsd),
    totalCostsUsd: r1(totalCostsUsd),
    netMonthlyUsd: Math.round(netMonthlyUsd),
    netWeeklyUsd: Math.round(netWeeklyUsd),
    netDailyUsd: Math.round(netDailyUsd * 100) / 100,
    roiMonthlyPct: Math.round(roiMonthlyPct * 10) / 10,
    roiAnnualPct: Math.round(roiMonthlyPct * 12 * 10) / 10,
    breakEvenDays,
    profitMarginPct: Math.round(profitMarginPct * 10) / 10,
    riskAdjustedMonthlyUsd: Math.round(riskAdjustedMonthlyUsd),
    riskFactor: Math.round(riskFactor * 100) / 100,
    targetUsd: config.minNetProfitTargetUsd,
    meetsMinimum,
    shortfallUsd: Math.round(shortfallUsd),
    verdict,
  };
}
