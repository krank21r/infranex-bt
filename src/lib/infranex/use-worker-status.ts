"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface WorkerStatusEntry {
  id: number;
  workerName: string;
  status: string;
  lastRun: string;
  durationMs: number;
  tasksProcessed: number;
  error: string | null;
  createdAt: string;
}

export interface WorkerStatusResponse {
  workers: WorkerStatusEntry[];
  latestSnapshot: {
    blockNumber: number;
    totalSubnets: number;
    scannedSubnets: number;
    neuronCount: number;
    taoPriceUsd: number;
    fetchedAt: string;
    source: string;
  } | null;
}

async function fetchWorkerStatus(): Promise<WorkerStatusResponse> {
  const res = await fetch("/api/workers/status", { cache: "no-store" });
  if (!res.ok) throw new Error(`workers ${res.status}`);
  return res.json();
}

/** Polls worker status every 30s. */
export function useWorkerStatus() {
  return useQuery({
    queryKey: ["worker-status"],
    queryFn: fetchWorkerStatus,
    refetchInterval: 30_000,
  });
}

export function useTriggerWorkers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/workers/trigger", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["worker-status"] });
    },
  });
}
