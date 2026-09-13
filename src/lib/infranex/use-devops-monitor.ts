"use client";

import { useQuery } from "@tanstack/react-query";
import type { TriggerEventDTO } from "@/lib/infranex/use-triggers";

/**
 * DEVOPS-1 — live payload for the DevOps Engine view. Polls every 20s;
 * the server micro-caches 10s so multiple tabs stay cheap.
 */

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

export interface DevopsMonitorPayload {
  ok: boolean;
  fetchedAt: string;
  summary: {
    monitored: number;
    healthy: number;
    warning: number;
    critical: number;
    daemonsOnline: number;
    openRecommendations: number;
  };
  miners: DevopsMinerDTO[];
  openEvents: TriggerEventDTO[];
  recentEvents: TriggerEventDTO[];
  lastPass: { at: string; status: string; durationMs: number; evaluated: number } | null;
  thresholds: DevopsThresholds;
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
