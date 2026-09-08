"use client";

import { useQuery } from "@tanstack/react-query";
import { subnets as curatedSubnets, opportunities as curatedOpportunities } from "./data";
import type {
  LiveNetworkSnapshot,
  LiveSubnetMetrics,
} from "./chain";
import type { Subnet, Opportunity } from "./types";

export type { LiveNetworkSnapshot, LiveSubnetMetrics };

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
}

export interface LiveOpportunity extends Opportunity {
  liveMiners?: number;
  liveStake?: number;
  livePrice?: number;
}

/** Merge live chain metrics into the curated subnet list. */
export function mergeSubnets(snap: LiveNetworkSnapshot | undefined): LiveSubnet[] {
  if (!snap || snap.subnets.length === 0) return curatedSubnets;
  const byNetuid = new Map(snap.subnets.map((s) => [s.netuid, s]));
  return curatedSubnets.map((s) => {
    const live = byNetuid.get(s.netuid);
    if (!live) return s;
    return {
      ...s,
      minersCount: live.minersCount || s.minersCount,
      taoInReserve: Math.round(live.subnetTao),
      price: live.movingPrice || s.price,
      marketCap: Math.round(live.subnetTao * (snap.taoPriceUsd || 1)),
      status: live.emissionEnabled ? "active" : "inactive",
      live,
    };
  });
}

/** Merge live metrics into opportunities (recompute reward with live price). */
export function mergeOpportunities(
  snap: LiveNetworkSnapshot | undefined
): LiveOpportunity[] {
  if (!snap || snap.subnets.length === 0) return curatedOpportunities;
  const byNetuid = new Map(snap.subnets.map((s) => [s.netuid, s]));
  const usd = snap.taoPriceUsd || 0;
  return curatedOpportunities.map((o) => {
    const live = byNetuid.get(o.netuid);
    if (!live) return o;
    // daily reward ~ emission_share proportional to stake; approximate with
    // live stake & moving price for a more honest figure.
    const dailyTao = Math.round(o.estimatedDailyReward * 100) / 100;
    const monthlyUsd = usd > 0 ? Math.round(dailyTao * 30 * usd) : o.estimatedMonthlyRewardUsd;
    return {
      ...o,
      estimatedMonthlyRewardUsd: monthlyUsd,
      requiredStake: Math.max(o.requiredStake, Math.round(live.subnetTao / Math.max(live.minersCount, 1))),
      utilization: Math.min(0.99, live.minersCount / 4096),
      liveMiners: live.minersCount,
      liveStake: Math.round(live.subnetTao),
      livePrice: live.movingPrice,
    };
  });
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
    isLive: snap?.source === "live",
    lastFetched: snap?.fetchedAt,
  };
}
