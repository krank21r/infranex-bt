"use client";

import { useQuery } from "@tanstack/react-query";
import {
  subnets as curatedSubnets,
  opportunities as curatedOpportunities,
} from "./data";
import {
  classifySubnetHardware,
  scoreMinersLedger,
  totalScore,
  riskLevel,
} from "./miner-score";
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
  //    Names / descriptions / GitHub come from the on-chain identity
  //    registry (SubnetIdentitiesV3); GPU requirements come from the
  //    work-type classifier (what the subnet actually computes), with a
  //    reward-stream fallback for subnets without a registered identity.
  for (const live of snap?.subnets ?? []) {
    if (seen.has(live.netuid)) continue;
    seen.add(live.netuid);
    const override = overrides?.get(live.netuid);
    const liveFields = new Set<string>(["minersCount", "taoInReserve", "price", "tempo", "status", "emission", "validatorsCount"]);
    const overriddenFields = new Set<string>();

    const rewarded = Math.max(live.rewardedMiners ?? 0, 0);
    const minerEm = live.minerEmissionTaoPerDay ?? 0;
    const perEarningDailyTao =
      rewarded > 0 && minerEm > 0
        ? minerEm / rewarded
        : minerEm > 0
          ? (minerEm / Math.max(live.minersCount, 1)) * 0.6
          : 0;
    const fallbackMonthly = perEarningDailyTao * 30 * (snap?.taoPriceUsd || 0);
    const hw = classifySubnetHardware(live.name, live.identityDescription, {
      fallbackMonthlyUsd: fallbackMonthly,
    });
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
      category: (override?.category as string) ?? (hw.classified ? hw.category : live.name ? "Registered subnet" : "Untracked"),
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
      minVramGb: (override?.minVramGb as number) ?? hw.minVramGb,
      recommendedGpu: (override?.recommendedGpu as string) ?? hw.recommendedGpu,
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

// ---------------------------------------------------------------------------
// Opportunity ranking — Miner's Ledger v2. Every subnet the chain scan
// returned (129 on Finney) runs through the SAME 5-pillar engine in
// miner-score.ts: per-EARNING-miner revenue → net of GPU/infra cost →
// seat safety → alpha economics → fit. No curated special-casing: curated
// rows only contribute names/categories when the chain identity is absent.
// ---------------------------------------------------------------------------

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
    // Root (SN0) is a staking pool, not a mining target — miners cannot
    // register a miner there, so it does not belong in mining opportunities.
    if (live.netuid === 0) continue;
    const curated = curatedByNetuid.get(live.netuid);

    // --- Top line: per-EARNING-miner revenue (chain-measured) ---
    const rewarded = Math.max(live.rewardedMiners ?? 0, 0);
    const minerEm = live.minerEmissionTaoPerDay ?? 0;
    const perEarningDailyTao =
      rewarded > 0 && minerEm > 0
        ? minerEm / rewarded
        : minerEm > 0
          ? (minerEm / Math.max(live.minersCount, 1)) * 0.6 // conservative when the reward vec is unavailable
          : 0;
    const grossMonthlyUsd = Math.round(perEarningDailyTao * 30 * usd);

    // --- Hardware: work type → GPU requirement + cost ---
    const name =
      live.name ?? curated?.subnetName ?? `Subnet ${live.netuid}`;
    const hardware = classifySubnetHardware(name, live.identityDescription, {
      fallbackCategory: curated?.category,
      fallbackVramGb: curated?.minVramGb,
      fallbackGpu: curated?.recommendedGpu,
      fallbackMonthlyUsd: grossMonthlyUsd,
    });

    const liveAgeBlocks =
      live.registeredAt != null && snap.blockNumber > live.registeredAt
        ? snap.blockNumber - live.registeredAt
        : null;

    const { components, factors, diag } = scoreMinersLedger({
      live,
      taoUsd: usd,
      hardware,
      liveAgeBlocks,
    });
    const score = totalScore(components);

    // Utilization: share of registered slots that actually earned reward
    // last epoch — the reward-concentration signal from the chain vecs.
    const util =
      diag.rewardedRatio != null
        ? diag.rewardedRatio
        : live.maxUids
          ? Math.min(0.99, live.minersCount / live.maxUids)
          : Math.min(0.99, live.minersCount / 4096);

    const reqStake =
      Math.round(
        (live.subnetTao / Math.max(live.minersCount, 1)) * 10
      ) / 10;

    let base: LiveOpportunity;
    if (curated) {
      base = { ...curated } as LiveOpportunity;
      if (live.name) base.subnetName = live.name;
    } else {
      base = {
        id: `opp-live-${live.netuid}`,
        netuid: live.netuid,
        subnetName: name,
        subnetSymbol: `α${live.netuid}`,
        category: hardware.category,
        type: "mining",
        minVramGb: hardware.minVramGb,
        recommendedGpu: hardware.recommendedGpu,
      } as LiveOpportunity;
    }

    rows.push({
      ...base,
      category: diag.hardwareClassified ? diag.category : base.category,
      score,
      rank: 0,
      estimatedDailyReward: diag.expectedDailyTao,
      estimatedMonthlyRewardUsd: diag.grossMonthlyUsd,
      estimatedApy:
        reqStake > 0
          ? Math.round(((diag.expectedDailyTao * 365) / reqStake) * 1000) / 10
          : 0,
      requiredStake: reqStake,
      utilization: util,
      riskLevel: riskLevel(score),
      confidence: Math.round(score) / 100,
      factors,
      status: live.emissionEnabled ? "active" : "pending",
      updatedAt,
      minVramGb: diag.minVramGb,
      recommendedGpu: diag.recommendedGpu,
      workType: diag.category,
      grossMonthlyUsd: diag.grossMonthlyUsd,
      netMonthlyUsd: diag.netMonthlyUsd,
      gpuCostMonthlyUsd: diag.gpuCostMonthlyUsd,
      infraCostMonthlyUsd: diag.infraCostMonthlyUsd,
      netDailyTao: diag.netDailyTao,
      alphaPriceUsd: diag.alphaPriceUsd,
      alphaChange24h: diag.alphaChange24h,
      liquidityTao: diag.liquidityTao,
      slippagePct: diag.slippagePct,
      burnCostTao: diag.burnCostTao,
      top10IncentiveShare: diag.top10IncentiveShare,
      rewardMedianShare: diag.rewardMedianShare,
      perEarningMeanDailyTao: diag.perEarningDailyTao,
      rewardedRatio: diag.rewardedRatio,
      rampWeeks: diag.rampWeeks,
      freeSlots: diag.freeSlots,
      totalSlots: diag.totalSlots,
      immunityBlocks: diag.immunityBlocks,
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
  const runCount = liveOpps.filter((o) => o.score >= 60).length;
  const watchCount = liveOpps.filter((o) => o.score >= 40 && o.score < 60).length;
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
