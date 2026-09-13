"use client";

import { useQuery } from "@tanstack/react-query";
import type { TriggerEventDTO } from "@/lib/infranex/use-triggers";

/**
 * DEVOPS-1 — live payload for the DevOps Engine view. Polls every 20s;
 * the server micro-caches 10s so multiple tabs stay cheap.
 */

/**
 * DEVOPS-3 — per-miner Miner Mindset posture (server type mirrored from
 * miner-mindset.ts MinerStrategyPosture).
 */
export interface MinerStrategyPostureDTO {
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

/** TIER1-1 — health score factor (mirrors health-score.ts HealthFactor). */
export interface MinerHealthFactorDTO {
  key: string;
  label: string;
  score: number;
  max: number;
  detail: string;
}

/** TIER1-1 — composite health (mirrors health-score.ts MinerHealth). */
export interface MinerHealthDTO {
  score: number;
  status: "healthy" | "warning" | "critical";
  factors: MinerHealthFactorDTO[];
  simulated: boolean;
}

/** TIER4 / RUNWAY-1 — immunity runway (mirrors runway.ts RunwayAssessment). */
export interface RunwayAssessmentDTO {
  verdict: "safe" | "watch" | "at_risk" | "expired";
  simulated: boolean;
  margins: {
    capacityFreeSlots: number | null;
    atCapacity: boolean;
    immunityBlocksLeft: number | null;
    incentive: number | null;
  };
  trajectory: {
    direction: "rising" | "stable" | "declining" | "collapsed" | "unknown";
    slopePerSample: number | null;
    samples: number;
  };
  tMinusBlocks: number | null;
  tMinusLabel: string | null;
  notes: string[];
}

export interface DevopsMinerDTO {
  deploymentId: string;
  minerName: string;
  netuid: number;
  subnetName: string;
  gpuModel: string;
  provider: string;
  mode: string;
  status: string;
  providerPodId: string | null;
  monthlyCost: number;
  createdAt: string;
  daemon: {
    status: string;
    lastSeenAt: string | null;
    pendingCommands: number;
    processAlive: boolean | null;
  } | null;
  gpu: {
    daemonStatus: string;
    utilPct: number | null;
    memUsedMb: number | null;
    memTotalMb: number | null;
    tempC: number | null;
    processAlive: boolean | null;
    at: string | null;
  } | null;
  gpuHistory: { at: string; tempC: number | null; utilPct: number | null }[];
  uid: {
    uid: number | null;
    incentive: number | null;
    emission: number | null;
    riskLevel: "healthy" | "warning" | "critical";
    riskCodes: string[];
  } | null;
  registration: { state: string | null; registeredUid: number | null };
  chain: {
    found: boolean;
    incentive: number | null;
    emissionPerMonthUsd: number | null;
    netProfitPerMonthUsd: number | null;
    roiPercent: number | null;
  };
  alerts: { level: string; code: string; message: string }[];
  strategy: MinerStrategyPostureDTO;
  /** TIER1-1 — composite 0-100 health score with per-factor breakdown. */
  health: MinerHealthDTO;
  /** TIER1-1 — last 40 miner log lines, newest first. */
  logs: { at: string; severity: string; source: string; message: string }[];
  /** TIER1-1 — latest Doctor (10-step inspector) facts for the host machine. */
  machine: {
    hostId: string;
    name: string;
    transport: string;
    status: string;
    os: string | null;
    gpuName: string | null;
    driverCuda: string | null;
    dockerVersion: string | null;
  } | null;
  /** DEVOPS-4 — synthetic probe + validator traffic for this miner. */
  service: {
    probe: {
      endpoint: string | null;
      mode: string;
      ok: boolean;
      httpStatus: number | null;
      ttfbMs: number | null;
      totalMs: number | null;
      errorKind: string | null;
      at: string;
    } | null;
    probeHistory: { at: string; ok: boolean; totalMs: number | null }[];
    latencyP50Ms: number | null;
    latencyP95Ms: number | null;
    successRatePct: number | null;
    probedCount: number;
    traffic: {
      windowMinutes: number | null;
      requests: number | null;
      distinctValidators: number | null;
      topValidatorHotkey: string | null;
      topValidatorCount: number | null;
      logFound: boolean;
      at: string;
    } | null;
  };
  /** TIER4 / RUNWAY-1 — immunity runway (verdict, margins, T-minus). */
  runway: RunwayAssessmentDTO | null;
}

export interface DevopsThresholds {
  tempWarnC: number;
  tempCriticalC: number;
  thermalPasses: number;
  utilFloorPct: number;
  idleUtilPasses: number;
  processDownPasses: number;
  daemonSilenceMs: number;
  sampleRetention: number;
  economicsShiftPct: number;
}

/** DEVOPS-3 — Miner Mindset strategy thresholds (mirrors MINDSET_THRESHOLDS). */
export interface DevopsMindsetThresholds {
  yieldCollapsePct: number;
  yieldCollapsePasses: number;
  alphaDropPct24h: number;
  arbitrageUpliftPct: number;
  maxAlternatives: number;
  hotUtilPct: number;
  hotUtilSamples: number;
  memPressureRatio: number;
  incentiveGapRatio: number;
  incentiveGapPasses: number;
}

/** DEVOPS-4 — Service Health thresholds (mirrors SERVICE_THRESHOLDS). */
export interface DevopsServiceThresholds {
  probeTimeoutMs: number;
  slowTotalMs: number;
  slowRatioVsMedian: number;
  failPasses: number;
  slowPasses: number;
  trafficHistoryWindows: number;
  minRequestsForDrought: number;
  minWindowsForDrought: number;
  droughtFloorRatio: number;
  droughtPasses: number;
}

export interface DevopsMonitorPayload {
  ok: boolean;
  fetchedAt: string;
  /** TIER3 — autopilot policy rules + recent auto-executed actions. */
  autopilot: {
    rules: {
      id: string;
      name: string;
      kind: string;
      minSeverity: string;
      mockOnly: boolean;
      maxPerHour: number;
      enabled: boolean;
    }[];
    recentActions: { id: string; kind: string; title: string; at: string; ruleName: string | null }[];
  };
  /** TIER3 — benchmark summary per started deployment. */
  benchmarks: {
    deploymentId: string;
    minerName: string;
    mode: string;
    latest: { at: string; p50Ms: number | null; p95Ms: number | null; successPct: number; samples: number } | null;
    baselineP50Ms: number | null;
    runs: number;
  }[];
  summary: {
    monitored: number;
    healthy: number;
    warning: number;
    critical: number;
    daemonsOnline: number;
    openRecommendations: number;
    /** TIER1-1 — fleet economics per day (spec §41). */
    infraCostUsdPerDay: number;
    revenueUsdPerDay: number;
    netUsdPerDay: number;
    avgHealthScore: number | null;
  };
  miners: DevopsMinerDTO[];
  openEvents: TriggerEventDTO[];
  recentEvents: TriggerEventDTO[];
  lastPass: { at: string; status: string; durationMs: number; evaluated: number } | null;
  thresholds: DevopsThresholds;
  mindsetThresholds: DevopsMindsetThresholds;
  serviceThresholds: DevopsServiceThresholds;
}

async function fetchDevopsMonitor(): Promise<DevopsMonitorPayload> {
  const res = await fetch("/api/devops/monitor", { cache: "no-store" });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) throw new Error(j?.error ?? `devops monitor ${res.status}`);
  return j as DevopsMonitorPayload;
}

/** Polls the DevOps aggregate every 20s. */
export function useDevopsMonitor() {
  return useQuery({
    queryKey: ["devops-monitor"],
    queryFn: fetchDevopsMonitor,
    refetchInterval: 20_000,
  });
}
