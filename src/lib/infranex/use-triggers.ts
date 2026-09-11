"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface TriggerEventDTO {
  id: string;
  kind: "RE_SYNC" | "SCALE" | "KILL" | "DEREG_RISK";
  severity: string;
  status: "open" | "approved" | "acted" | "dismissed" | "resolved";
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
  deploymentId: string | null;
  netuid: number | null;
  runbook: string[];
  createdAt: string;
  resolvedAt: string | null;
}

export interface UidDefenseState {
  deploymentId: string;
  minerName: string;
  netuid: number;
  uid: number | null;
  hotkey: string | null;
  riskLevel: "healthy" | "warning" | "critical";
  riskCodes: string[];
  history: { incentive: number | null; consensus: number | null; at: string }[];
  cohort: { registeredUids: number; earningUids: number; medianRewardedIncentive: number } | null;
  note?: string;
}

export interface TriggersPayload {
  ok: boolean;
  open: TriggerEventDTO[];
  recent: TriggerEventDTO[];
  uid?: UidDefenseState[];
  pass?: {
    deploymentsEvaluated: number;
    created: number;
    refreshed: number;
    resolved: number;
    evaluatedAt: string;
  };
}

async function fetchTriggers(): Promise<TriggersPayload> {
  const res = await fetch("/api/triggers", { cache: "no-store" });
  if (!res.ok) throw new Error(`triggers ${res.status}`);
  return res.json();
}

/** Polls trigger events every 45s. */
export function useTriggers() {
  return useQuery({
    queryKey: ["triggers"],
    queryFn: fetchTriggers,
    refetchInterval: 45_000,
  });
}

export function useTriggerActions() {
  const qc = useQueryClient();
  const post = async (body: Record<string, unknown>): Promise<TriggersPayload & { event?: TriggerEventDTO; action?: string }> => {
    const res = await fetch("/api/triggers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error ?? `triggers ${res.status}`);
    qc.invalidateQueries({ queryKey: ["triggers"] });
    return j;
  };
  return {
    runPass: () => post({ action: "run" }),
    approve: (id: string) => post({ action: "approve", id }),
    dismiss: (id: string) => post({ action: "dismiss", id }),
    act: (id: string) => post({ action: "act", id }),
  };
}
