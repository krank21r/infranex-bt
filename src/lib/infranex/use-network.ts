"use client";

import { useQuery } from "@tanstack/react-query";
import {
  subnets as curatedSubnets,
  opportunities as curatedOpportunities,
  curatedComponentScores,
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
      // On-chain identity name is authoritative when registered.
      if (live.name) { merged.name = live.name; liveFields.add("name"); }
      if (live.identityDescription) { merged.description = live.identityDescription; liveFields.add("description"); }
      if (live.minersCount) { merged.minersCount = live.minersCount; liveFields.add("minersCount"); }
      if (live.subnetTao) { merged.taoInReserve = Math.round(live.subnetTao); liveFields.add("taoInReserve"); }
      if (live.movingPrice) { merged.price = live.movingPrice; liveFields.add("price"); }
      if (live.subnetTao && snap?.taoPriceUsd) { merged.marketCap = Math.round(live.subnetTao * snap.taoPriceUsd); liveFields.add("marketCap"); }
      if (live.tempo) { merged.tempo = live.tempo; liveFields.add("tempo"); }
      // Real emission (TAO value per block) + validator count.
      if (live.emission != null) { merged.emission = live.emission; liveFields.add("emission"); }
      if (live.validatorsCount != null) { merged.validatorsCount = live.validatorsCount; liveFields.add("validatorsCount"); }
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

  // 2. Add untracked subnets from the chain scan (no curated metadata).
  //    Names / descriptions / GitHub now come from the on-chain identity
  //    registry (SubnetIdentitiesV3 — 121/129 subnets registered); GPU
  //    requirements are estimated from the measured reward stream.
  for (const live of snap?.subnets ?? []) {
    if (seen.has(live.netuid)) continue;
    seen.add(live.netuid);
    const override = overrides?.get(live.netuid);
    const liveFields = new Set<string>(["minersCount", "taoInReserve", "price", "tempo", "status", "emission", "validatorsCount"]);
    const overriddenFields = new Set<string>();

    const estGpu = estimateGpuTier(perMinerDailyTao(live) * 30 * (snap?.taoPriceUsd || 0));
    const regBlock = live.registeredAt;
    const createdAt =
      regBlock && snap && snap.blockNumber > regBlock
        ? new Date(Date.now() - (snap.blockNumber - regBlock) * 12_000).toISOString()
        : "";

    const merged: Subnet = {
      netuid: live.netuid,
      name: (override?.name as string) ?? live.name ?? `Subnet ${live.netuid}`,
      symbol: `α${live.netuid}`,
      description:
        (override?.description as string) ??
        live.identityDescription ??
        (live.name ? "On-chain registered subnet — live chain data." : "Untracked subnet — live chain data only."),
      category: (override?.category as string) ?? "Live chain",
      owner: live.owner ?? "",
      tempo: live.tempo || 0,
      emission: live.emission ?? 0,
      taoInReserve: Math.round(live.subnetTao),
      price: live.movingPrice,
      marketCap: snap?.taoPriceUsd ? Math.round(live.subnetTao * snap.taoPriceUsd) : 0,
      volume24h: 0,
      change24h: 0,
      minersCount: live.minersCount,
      validatorsCount: live.validatorsCount ?? 0,
      maxNeurons: live.maxUids ?? 4096,
      status: live.emissionEnabled ? "active" : "inactive",
      registrationOpen: false,
      createdAt,
      tags: [],
      minVramGb: (override?.minVramGb as number) ?? estGpu.minVramGb,
      recommendedGpu: (override?.recommendedGpu as string) ?? estGpu.recommendedGpu,
      githubUrl: (override?.githubUrl as string) ?? live.identityGithub ?? null,
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

// ---------------------------------------------------------------------------
// Live economics — real per-miner emission accounting, GPU tier estimates.
// These power the Monthly / APY / GPU Req / Util columns for ALL subnets.
// ---------------------------------------------------------------------------

/**
 * Real per-miner daily TAO for a subnet: the emission that flowed to
 * rewarded miners last epoch (chain-measured), converted to TAO value
 * and averaged over every registered slot — the standard per-miner view.
 * The Util. column shows how concentrated the rewards actually are.
 * Deterministic per snapshot.
 */
function perMinerDailyTao(live: LiveSubnetMetrics): number {
  if (!live.minerEmissionTaoPerDay || live.minerEmissionTaoPerDay <= 0) return 0;
  return live.minerEmissionTaoPerDay / Math.max(live.minersCount, 1);
}

/**
 * Deterministic GPU tier estimated from the reward stream: what class of
 * hardware a subnet's per-miner monthly USD can plausibly support. Used
 * only when no curated / user-provided GPU requirement exists — always
 * suffixed "(est.)" in the UI.
 */
export function estimateGpuTier(monthlyUsdPerMiner: number): {
  minVramGb: number;
  recommendedGpu: string;
} {
  if (monthlyUsdPerMiner >= 1200) return { minVramGb: 141, recommendedGpu: "H200 141GB (est.)" };
  if (monthlyUsdPerMiner >= 600) return { minVramGb: 94, recommendedGpu: "H100 NVL (est.)" };
  if (monthlyUsdPerMiner >= 300) return { minVramGb: 80, recommendedGpu: "H100 80GB (est.)" };
  if (monthlyUsdPerMiner >= 140) return { minVramGb: 80, recommendedGpu: "A100 80GB (est.)" };
  if (monthlyUsdPerMiner >= 60) return { minVramGb: 48, recommendedGpu: "RTX A6000 (est.)" };
  if (monthlyUsdPerMiner >= 25) return { minVramGb: 24, recommendedGpu: "RTX 4090 (est.)" };
  if (monthlyUsdPerMiner >= 8) return { minVramGb: 16, recommendedGpu: "RTX 4060 Ti (est.)" };
  return { minVramGb: 8, recommendedGpu: "Entry GPU (est.)" };
}

/** Hardware accessibility score — lower VRAM requirements are easier to meet. */
function hardwareScoreForVram(vram: number): number {
  if (vram <= 8) return 88;
  if (vram <= 16) return 74;
  if (vram <= 24) return 64;
  if (vram <= 48) return 46;
  if (vram <= 94) return 32;
  return 22;
}

/**
 * Profitability from REAL per-miner monthly USD (log-scale, deterministic):
 * $0 → 18, $10 → 39, $100 → 60, $500 → 75, $1k → 81, $5k+ → 96.
 */
function profitabilityScore(monthlyUsd: number): number {
  return clampScore(18 + 21 * Math.log10(Math.max(monthlyUsd, 0) + 1), 5, 96);
}

/**
 * Deterministically synthesize the 3-pillar score components for an
 * untracked subnet from live chain metrics. No randomness — the same
 * snapshot always produces the same score, so ranks stay stable across
 * re-renders. All inputs are measured on chain (per-neuron emission vecs,
 * active/incentive/dividends, max allowed uids, validator counts).
 */
function synthesizeComponents(
  live: LiveSubnetMetrics,
  taoUsd: number,
  taoChange24h: number
): ScoreComponents {
  const stake = Math.max(live.subnetTao, 1);
  const registered = Math.max(live.minersCount, 1);
  const maxUids = Math.max(live.maxUids ?? registered, registered, 1);
  const monthlyUsdPerMiner = perMinerDailyTao(live) * 30 * (taoUsd || 0);
  const gpu = estimateGpuTier(monthlyUsdPerMiner);
  // Registration pressure: share of reward slots already taken.
  const saturation = Math.min(1, registered / maxUids);
  const roomRatio = Math.max(0, maxUids - registered) / maxUids;

  return {
    // Deeper staked reserve → stronger economic gravity (log-scaled).
    economic_potential: clampScore(22 + 13 * Math.log10(stake / 1_000 + 1), 5, 96),
    // Room left in the metagraph — fuller networks are more contested.
    competition: clampScore(95 - saturation * 70, 10, 96),
    // Emission enabled + real TAO-value emission per day → steadier rewards.
    reward_stability: live.emissionEnabled
      ? clampScore(48 + (live.emissionTaoPerDay ?? 0) * 1.5, 40, 80)
      : 20,
    // Network-wide TAO momentum + deep-reserve bonus.
    market_conditions: clampScore(
      50 + clampScore(taoChange24h, -20, 20) + (stake > 100_000 ? 8 : 0),
      5,
      92
    ),
    // Registration headroom against the subnet's max allowed UIDs.
    new_miner_accessibility: clampScore(30 + roomRatio * 65, 8, 92),
    // Emission on + REAL validator coverage from the dividends vector.
    network_health: clampScore(
      40 + (live.emissionEnabled ? 25 : 0) + Math.min(15, (live.validatorsCount ?? 0) / 3),
      20,
      85
    ),
    // Match between the estimated GPU tier and general accessibility.
    hardware_suitability: hardwareScoreForVram(gpu.minVramGb),
    // Net economics from measured per-miner monthly USD.
    profitability_potential: profitabilityScore(monthlyUsdPerMiner),
  };
}

/**
 * Build the full opportunity ranking for EVERY subnet the chain scan
 * returned (129 on Finney). Every row — curated and untracked — carries
 * real chain-measured economics: per-miner daily/monthly rewards from the
 * per-neuron emission vectors, APY against required stake, utilization
 * against max allowed UIDs, and a GPU requirement (curated/user data when
 * available, otherwise a deterministic "(est.)" tier from the reward
 * stream). Rows are sorted by score and ranked 1..N together.
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

    // --- Real economics, identical formula for every row ---
    const dailyTao =
      Math.round(perMinerDailyTao(live) * 10_000) / 10_000;
    const monthlyUsd = usd > 0 ? Math.round(dailyTao * 30 * usd) : 0;
    const reqStake =
      Math.round(
        (live.subnetTao / Math.max(live.minersCount, 1)) * 10
      ) / 10;
    // Utilization: share of registered slots that actually earned reward
    // last epoch (rewarded miners / registered UIDs) — a real measure of
    // how concentrated rewards are. Falls back to registration pressure.
    const util =
      live.rewardedMiners != null
        ? Math.min(0.99, live.rewardedMiners / Math.max(live.minersCount, 1))
        : live.maxUids
          ? Math.min(0.99, live.minersCount / live.maxUids)
          : Math.min(0.99, live.minersCount / 4096);

    let components: ScoreComponents;
    let base: LiveOpportunity;

    if (curated) {
      // Curated subnet — keep the hand-tuned factors, but refresh the
      // profitability factor from REAL emission economics so it matches
      // the monthly $ displayed next to it. The on-chain identity name
      // wins over the curated name when one is registered.
      const hand = curatedComponentScores[live.netuid];
      components = {
        ...(hand ?? {
          economic_potential: 55,
          competition: 55,
          reward_stability: 55,
          market_conditions: 50,
          new_miner_accessibility: 55,
          network_health: 60,
          hardware_suitability: 55,
          profitability_potential: 50,
        }),
        profitability_potential: profitabilityScore(monthlyUsd),
      };
      base = { ...curated };
      if (live.name) base.subnetName = live.name;
    } else {
      // Untracked subnet — synthesize the full component set.
      components = synthesizeComponents(live, usd, snap.taoChange24h ?? 0);
      const gpu = estimateGpuTier(monthlyUsd);
      base = {
        id: `opp-live-${live.netuid}`,
        netuid: live.netuid,
        subnetName: live.name ?? `Subnet ${live.netuid}`,
        subnetSymbol: `α${live.netuid}`,
        category: "Live chain",
        type: "mining",
        minVramGb: gpu.minVramGb,
        recommendedGpu: gpu.recommendedGpu,
      } as LiveOpportunity;
    }

    const score = totalScore(components);
    rows.push({
      ...base,
      score,
      rank: 0,
      estimatedDailyReward: dailyTao,
      estimatedMonthlyRewardUsd: monthlyUsd,
      // APY vs the required stake capital, in percent.
      estimatedApy:
        reqStake > 0
          ? Math.round(((dailyTao * 365) / reqStake) * 1000) / 10
          : 0,
      requiredStake: reqStake,
      utilization: util,
      riskLevel: riskLevel(score),
      confidence: Math.round(score) / 100,
      factors: deriveFactors(components),
      status: live.emissionEnabled ? "active" : "pending",
      updatedAt,
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
  const runCount = liveOpps.filter((o) => o.score >= 70).length;
  const watchCount = liveOpps.filter((o) => o.score >= 46 && o.score < 70).length;
  const avoidCount = liveOpps.filter((o) => o.score < 46).length;

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
