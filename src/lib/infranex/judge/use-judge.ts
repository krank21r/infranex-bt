"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  JudgeProfileData,
  JudgeKind,
  JudgeCohort,
  JudgeDimension,
  JudgeSource,
} from "./types";

export type { JudgeProfileData, JudgeKind, JudgeCohort, JudgeDimension, JudgeSource };

export interface JudgeRunRecord {
  id: string;
  netuid: number;
  subnetName: string;
  spec: {
    latencyMs: number;
    uptimePct: number;
    qualityPct: number;
    throughputTps: number;
    pricePerMTokUsd: number;
  };
  result: {
    composite: number;
    verdict: string;
    percentileEstimate: number;
    medianMultiple: number;
  };
  composite: number;
  verdict: string;
  createdAt: string;
}

export interface JudgeableSubnet {
  netuid: number;
  name: string;
  symbol: string;
  category: string;
  githubUrl?: string | null;
}

async function fetchProfiles(): Promise<{ ok: boolean; profiles: (JudgeProfileData & { fetchedAt: string })[] }> {
  const res = await fetch("/api/judge/profiles", { cache: "no-store" });
  if (!res.ok) throw new Error(`judge/profiles ${res.status}`);
  return res.json();
}

async function fetchRuns(): Promise<{ ok: boolean; runs: JudgeRunRecord[] }> {
  const res = await fetch("/api/judge/runs", { cache: "no-store" });
  if (!res.ok) throw new Error(`judge/runs ${res.status}`);
  return res.json();
}

/** Persisted judge profiles (polled every 60s). */
export function useJudgeProfiles() {
  return useQuery({
    queryKey: ["judge-profiles"],
    queryFn: fetchProfiles,
    refetchInterval: 60_000,
  });
}

/** Recent simulation runs. */
export function useJudgeRuns() {
  return useQuery({
    queryKey: ["judge-runs"],
    queryFn: fetchRuns,
    refetchInterval: 60_000,
  });
}

/** Sync (build/refresh) a subnet's judge profile. */
export function useJudgeSync() {
  const qc = useQueryClient();
  return async (netuid: number): Promise<{ profile: JudgeProfileData }> => {
    const res = await fetch("/api/judge/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ netuid }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error ?? `judge/sync ${res.status}`);
    qc.invalidateQueries({ queryKey: ["judge-profiles"] });
    return j;
  };
}

/** Run the mock-validator simulation. */
export function useJudgeSimulate() {
  const qc = useQueryClient();
  return async (
    netuid: number,
    spec: { latencyMs: number; uptimePct: number; qualityPct: number; throughputTps: number; pricePerMTokUsd: number }
  ): Promise<{ profile: JudgeProfileData; result: Record<string, unknown> & { composite: number; verdict: string } }> => {
    const res = await fetch("/api/judge/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ netuid, spec }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error ?? `judge/simulate ${res.status}`);
    qc.invalidateQueries({ queryKey: ["judge-runs"] });
    return j;
  };
}
