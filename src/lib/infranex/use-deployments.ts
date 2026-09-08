"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface DeploymentStep {
  name: string;
  label: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  startedAt: string | null;
  completedAt: string | null;
  output: string[];
}

export interface DeploymentConfig {
  subnet: { netuid: number; name: string; symbol: string; category: string; minVramGb: number; recommendedGpu: string };
  gpu: { model: string; vramGb: number; provider: string; hourlyPrice: number; monthlyPrice: number; region: string };
  docker: { imageName: string; runtime: string; ports: string[]; volumes: { path: string; sizeGb: number }[]; envVars: { name: string; value: string; secret: boolean }[]; command: string; minMemoryGb: number; minVcpuCount: number; diskGb: number };
  miner: { network: string; netuid: number; walletName: string; hotkeyName: string; axonPort: number; prometheusPort: number; subtensorNetwork: string; extraArgs: string[] };
  cost: { hourlyUsd: number; monthlyUsd: number; estimatedMonthlyRevenueUsd: number; estimatedRoiPercent: number };
  requirements: { minVramGb: number; pythonVersion: string; cudaVersion: string; dockerRequired: boolean; nvidiaRuntimeRequired: boolean };
}

export interface DeploymentRecord {
  id: string;
  minerName: string;
  netuid: number;
  subnetName: string;
  gpuModel: string;
  provider: string;
  status: string;
  progress: number;
  mode: string;
  hourlyCost: number;
  monthlyCost: number;
  estimatedRevenue: number;
  config: DeploymentConfig | null;
  providerPodId: string | null;
  hotkey: string | null;
  steps: DeploymentStep[];
  createdAt: string;
  updatedAt: string;
}

async function fetchDeployments(): Promise<DeploymentRecord[]> {
  const res = await fetch("/api/deployments", { cache: "no-store" });
  if (!res.ok) throw new Error(`deployments ${res.status}`);
  const j = await res.json();
  return j.deployments as DeploymentRecord[];
}

export function useDeployments(poll = true) {
  return useQuery({
    queryKey: ["deployments"],
    queryFn: fetchDeployments,
    refetchInterval: poll ? 3000 : false,
  });
}

export function useDeploymentDetail(id: string | null) {
  return useQuery({
    queryKey: ["deployment", id],
    queryFn: async () => {
      if (!id) return null;
      const res = await fetch(`/api/deployments/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`deployment ${res.status}`);
      const j = await res.json();
      return j.deployment as DeploymentRecord;
    },
    enabled: !!id,
    refetchInterval: 3000,
  });
}

export function useCreateDeployment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      netuid: number;
      offerId: string;
      minerName: string;
      hotkey?: string;
      walletName?: string;
      mode: "mock" | "runpod";
    }) => {
      const res = await fetch("/api/deployments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      const j = await res.json();
      return j.deployment as DeploymentRecord;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deployments"] }),
  });
}

export function useTickDeployment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/deployments/${id}/tick`, { method: "POST" });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      const j = await res.json();
      return j.deployment as DeploymentRecord;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["deployments"] });
      qc.invalidateQueries({ queryKey: ["deployment", data.id] });
    },
  });
}

export function useTerminateDeployment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/deployments/${id}/terminate`, { method: "POST" });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      const j = await res.json();
      return j.deployment as DeploymentRecord;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deployments"] });
    },
  });
}

export function useDeleteDeployment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/deployments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deployments"] }),
  });
}
