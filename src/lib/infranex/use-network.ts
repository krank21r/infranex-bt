"use client";

import { useQuery } from "@tanstack/react-query";
import {
  subnets as curatedSubnets,
  opportunities as curatedOpportunities,
  deriveFactors,
  totalScore,
  riskLevel,
  type ScoreComponents,
} from "./data";
import type {
  LiveNetworkSnapshot,
  LiveSubnetMetrics,
  NeuronMetrics,
} from "./chain";
import type { Subnet, Opportunity } from "./types";

export type { LiveNetworkSnapshot, LiveSubnetMetrics, NeuronMetrics };

async function fetchNetwork(): Promise<LiveNetworkSnapshot> {
  const res = await fetch("/api/network", { cache: "no-store" });
  if (!res.ok) throw new Error(`network ${res.status}`);
  return res.json();
}

/**
 * Polls /api/network every 30s. Returns live chain + price data, with
 * `isLive` indicating whether the latest fetch was a real chain snapshot.
 */
export function useNetwork() {
  return useQuery({
    queryKey: ["network"],
    queryFn: fetchNetwork,
    refetchInterval: 30_000,
    refetchOnReconnect: true,
    select: (data) => ({
      ...data,
      isLive: data.source === "live",
      isStale: data.source !== "live",
    }),
  });
}

export interface LiveSubnet extends Subnet {
  live?: LiveSubnetMetrics;
  /** Which fields have live chain data (vs curated). */
  liveFields: Set<string>;
  /** Which fields have user overrides (vs curated). */
  overriddenFields: Set<string>;
}

export interface LiveOpportunity extends Opportunity {
  liveMiners?: number;
  liveStake?: number;
  livePrice?: number;
}

/** Merge live chain metrics + user overrides into the curated subnet list.
 *  Includes ALL subnets from the chain scan (not just the 16 curated ones).
 *  Untracked subnets get a generic name like "Subnet N" with live data only.
 */
export function mergeSubnets(
  snap: LiveNetworkSnapshot | undefined,
  overrides?: Map<number, Record<string, unknown>>
): LiveSubnet[] {
  const byNetuid = new Map(snap?.subnets.map((s) => [s.netuid, s]) ?? []);
  const seen = new Set<number>();
  const result: LiveSubnet[] = [];

  // 1. Process curated subnets first (they have names, descriptions, etc.)
  for (const s of curatedSubnets) {
    seen.add(s.netuid);
    const live = byNetuid.get(s.netuid);
    const override = overrides?.get(s.netuid);
    const liveFields = new Set<string>();
    const overriddenFields = new Set<string>();

    let merged: Subnet = { ...s };

    if (live) {
      if (live.minersCount) { merged.minersCount = live.minersCount; liveFields.add("minersCount"); }
      if (live.subnetTao) { merged.taoInReserve = Math.round(live.subnetTao); liveFields.add("taoInReserve"); }
      if (live.movingPrice) { merged.price = live.movingPrice; liveFields.add("price"); }
      if (live.subnetTao && snap?.taoPriceUsd) { merged.marketCap = Math.round(live.subnetTao * snap.taoPriceUsd); liveFields.add("marketCap"); }
      if (live.tempo) { merged.tempo = live.tempo; liveFields.add("tempo"); }
      merged.status = live.emissionEnabled ? "active" : "inactive";
      liveFields.add("status");
    }

    if (override) {
      for (const [key, value] of Object.entries(override)) {
        if (value != null && value !== "") {
          (merged as unknown as Record<string, unknown>)[key] = value;
          overriddenFields.add(key);
        }
      }
    }

    result.push({ ...merged, live, liveFields, overriddenFields });
  }

  // 2. Add untracked subnets from the chain scan (no curated metadata)
  for (const live of snap?.subnets ?? []) {
    if (seen.has(live.netuid)) continue;
    seen.add(live.netuid);
    const override = overrides?.get(live.netuid);
    const liveFields = new Set<string>(["minersCount", "taoInReserve", "price", "tempo", "status"]);
    const overriddenFields = new Set<string>();

    const merged: Subnet = {
      netuid: live.netuid,
      name: override?.name as string ?? `Subnet ${live.netuid}`,
      symbol: `α${live.netuid}`,
      description: (override?.description as string) ?? "Untracked subnet — live chain data only.",
      category: (override?.category as string) ?? "Unknown",
      owner: "",
      tempo: live.tempo || 0,
      emission: 0,
      taoInReserve: Math.round(live.subnetTao),
      price: live.movingPrice,
      marketCap: snap?.taoPriceUsd ? Math.round(live.subnetTao * snap.taoPriceUsd) : 0,
      volume24h: 0,
      change24h: 0,
      minersCount: live.minersCount,
      validatorsCount: 0,
      maxNeurons: 4096,
      status: live.emissionEnabled ? "active" : "inactive",
      registrationOpen: false,
      createdAt: "",
      tags: [],
      minVramGb: (override?.minVramGb as number) ?? 0,
      recommendedGpu: (override?.recommendedGpu as string) ?? "Unknown",
      githubUrl: (override?.githubUrl as string) ?? null,
      website: null,
    };

    if (override) {
      for (const [key, value] of Object.entries(override)) {
        if (value != null && value !== "" && !(key in merged)) {
          (merged as unknown as Record<string, unknown>)[key] = value;
          overriddenFields.add(key);
        }
      }
    }

    result.push({ ...merged, live, liveFields, overriddenFields });
  }

  return result;
}

const clampScore = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * Deterministically synthesize the 3-pillar score components for an
 * untracked subnet from live chain metrics. No randomness — the same
 * snapshot always produces the same score, so ranks stay stable across
 * re-renders.
 */
function synthesizeComponents(
  live: LiveSubnetMetrics,
  taoUsd: number,
  taoChange24h: number
): ScoreComponents {
  const stake = Math.max(live.subnetTao, 1);
  const miners = Math.max(live.minersCount, 1);
  // TAO reaching a single miner per day (720 blocks/day), then vs a
  // reference single-GPU rental (~$1/hr → $720/mo).
  const monthlyUsdPerMiner = live.emission
    ? ((live.emission * 720) / miners) * 30 * (taoUsd || 0)
    : 0;
  const gpuCostUsdMonth = 720;
  const marginRatio =
    (monthlyUsdPerMiner - gpuCostUsdMonth) / gpuCostUsdMonth;

  return {
    // Deeper staked reserve → stronger economic gravity (log-scaled).
    economic_potential: clampScore(22 + 13 * Math.log10(stake / 1_000 + 1), 5, 96),
    // Inverse of saturation against the 4096-neuron cap.
    competition: clampScore(100 - (miners / 4096) * 260, 10, 96),
    // Emission enabled + meaningful per-block emission → steadier rewards.
    reward_stability: live.emissionEnabled
      ? clampScore(52 + (live.emission ?? 0) * 30, 40, 80)
      : 20,
    // Network-wide TAO momentum + deep-reserve bonus.
    market_conditions: clampScore(
      50 + clampScore(taoChange24h, -20, 20) + (stake > 100_000 ? 8 : 0),
      5,
      92
    ),
    // Room to register: fewer miners → easier entry.
    new_miner_accessibility: clampScore(100 - miners / 6, 8, 92),
    // Emission on + validator coverage proxies.
    network_health: clampScore(
      40 + (live.emissionEnabled ? 25 : 0) + Math.min(15, (live.validatorsCount ?? 0) / 16),
      20,
      85
    ),
    // Hardware requirements unknown for untracked subnets → neutral middle.
    hardware_suitability: 55,
    // Net ROI after reference GPU cost.
    profitability_potential: clampScore(
      35 + 3.5 * clampScore(marginRatio * 100, -30, 18),
      5,
      96
    ),
  };
}

/**
 * Build the full opportunity ranking for EVERY subnet the chain scan
 * returned (129 on Finney). Curated subnets keep their hand-tuned
 * component scores, refreshed with live economics; untracked subnets get
 * deterministic scores synthesized from live chain metrics. All rows are
 * sorted by score and ranked 1..N together.
 */
export function mergeOpportunities(
  snap: LiveNetworkSnapshot | undefined
): LiveOpportunity[] {
  if (!snap || snap.subnets.length === 0) return curatedOpportunities;
  const curatedByNetuid = new Map(
    curatedOpportunities.map((o) => [o.netuid, o])
  );
  const usd = snap.taoPriceUsd || 0;
  const updatedAt = new Date().toISOString();
  const rows: LiveOpportunity[] = [];

  for (const live of snap.subnets) {
    const curated = curatedByNetuid.get(live.netuid);

    if (curated) {
      // Curated subnet — keep the hand-tuned score & factors, refresh
      // economics with live chain values.
      const dailyTao = Math.round(curated.estimatedDailyReward * 100) / 100;
      rows.push({
        ...curated,
        estimatedMonthlyRewardUsd:
          usd > 0 ? Math.round(dailyTao * 30 * usd) : curated.estimatedMonthlyRewardUsd,
        requiredStake: Math.max(
          curated.requiredStake,
          Math.round(live.subnetTao / Math.max(live.minersCount, 1))
        ),
        utilization: Math.min(0.99, live.minersCount / 4096),
        liveMiners: live.minersCount,
        liveStake: Math.round(live.subnetTao),
        livePrice: live.movingPrice,
        updatedAt,
      });
      continue;
    }

    // Untracked subnet — synthesize score from live metrics only.
    const components = synthesizeComponents(
      live,
      usd,
      snap.taoChange24h ?? 0
    );
    const score = totalScore(components);
    // Same per-miner capture assumption as the curated model (0.12% of
    // subnet emission) so USD figures stay comparable across rows.
    const dailyTao =
      Math.round((live.emission ?? 0) * 720 * 0.0012 * 100) / 100;
    const reqStake =
      Math.round(
        (live.subnetTao / Math.max(live.minersCount, 1)) * 10
      ) / 10;
    rows.push({
      id: `opp-live-${live.netuid}`,
      netuid: live.netuid,
      subnetName: live.name ?? `Subnet ${live.netuid}`,
      subnetSymbol: `α${live.netuid}`,
      category: "Live chain",
      type: "mining",
      score,
      rank: 0,
      estimatedDailyReward: dailyTao,
      estimatedMonthlyRewardUsd:
        usd > 0 ? Math.round(dailyTao * 30 * usd) : 0,
      estimatedApy:
        reqStake > 0 && usd > 0
          ? Math.round(((dailyTao * 365 * usd) / reqStake) * 10) / 10
          : 0,
      requiredStake: reqStake,
      utilization: Math.min(0.99, live.minersCount / 4096),
      riskLevel: riskLevel(score),
      confidence: Math.round(score) / 100,
      factors: deriveFactors(components),
      status: live.emissionEnabled ? "active" : "pending",
      updatedAt,
      minVramGb: 0,
      recommendedGpu: "Unknown",
      liveMiners: live.minersCount,
      liveStake: Math.round(live.subnetTao),
      livePrice: live.movingPrice,
    });
  }

  rows.sort((a, b) => b.score - a.score);
  rows.forEach((o, i) => (o.rank = i + 1));
  return rows;
}

/** Aggregated dashboard metrics using live values where available. */
export function getLiveDashboardMetrics(snap: LiveNetworkSnapshot | undefined) {
  const liveSubnets = mergeSubnets(snap);
  const liveOpps = mergeOpportunities(snap);
  const trackedSubnets = curatedSubnets.length;
  const activeSubnets = liveSubnets.filter((s) => s.status === "active").length;
  const totalMiners = liveSubnets.reduce((a, s) => a + s.minersCount, 0);
  const totalMarketCap = snap?.taoMarketCapUsd
    ? snap.taoMarketCapUsd
    : liveSubnets.reduce((a, s) => a + s.marketCap, 0);
  const avgScore =
    liveOpps.reduce((a, o) => a + o.score, 0) / liveOpps.length;
  const runCount = liveOpps.filter((o) => o.score >= 75).length;
  const watchCount = liveOpps.filter((o) => o.score >= 40 && o.score < 75).length;
  const avoidCount = liveOpps.filter((o) => o.score < 40).length;

  return {
    trackedSubnets,
    activeSubnets,
    totalMiners,
    totalValidators: 0,
    totalMarketCap,
    totalEmission: liveSubnets.reduce((a, s) => a + s.emission, 0),
    avgScore: Math.round(avgScore * 10) / 10,
    runCount,
    watchCount,
    avoidCount,
    portfolioEarnings: 0,
    portfolioDailyEmission: 0,
    activeMiners: 0,
    taoUsd: snap?.taoPriceUsd ?? 0,
    taoChange24h: snap?.taoChange24h ?? 0,
    taoMarketCap: snap?.taoMarketCapUsd ?? 0,
    blockNumber: snap?.blockNumber ?? 0,
    totalSubnets: snap?.totalSubnets ?? 0,
    scannedSubnets: snap?.subnets.length ?? 0,
    neuronCount: snap?.neurons.length ?? 0,
    isLive: snap?.source === "live",
    lastFetched: snap?.fetchedAt,
  };
}
