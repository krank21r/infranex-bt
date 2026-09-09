// DevOps Engine — react-query hooks for hosts, validation and fixes.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface DevopsHostInfo {
  os?: string;
  osId?: string;
  arch?: string;
  gpuName?: string;
  gpuVramMb?: number;
  driverVersion?: string;
  driverCuda?: string;
  dockerVersion?: string;
  composeVersion?: string;
  toolkitVersion?: string;
  dockerNvidiaRuntime?: boolean;
  envFileWritten?: boolean;
}

export interface DevopsHost {
  id: string;
  name: string;
  transport: "ssh" | "mock";
  host: string;
  port: number;
  user: string;
  authMethod: "password" | "key";
  provider: string;
  status: "pending" | "validating" | "ready" | "needs_fix" | "failed";
  autoFixSafe: boolean;
  hostInfo: DevopsHostInfo | null;
  secretHint?: string;
  createdAt: string;
}

export interface HostCheckRow {
  id: string;
  hostId: string;
  runId: string;
  step: number;
  name: string;
  status: "pending" | "running" | "pass" | "fail" | "fixed" | "skipped";
  output: string;
  remediation: string | null;
  durationMs: number;
  createdAt: string;
}

export interface StepResultDto {
  step: number;
  name: string;
  status: string;
  output: string;
  remediation: string | null;
  durationMs: number;
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const j = (await res.json()) as T & { error?: string };
  if (!res.ok || j.error) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j;
}

export function useDevopsHosts() {
  return useQuery({
    queryKey: ["devops-hosts"],
    queryFn: () => fetchJson<{ hosts: DevopsHost[] }>("/api/devops/hosts"),
    refetchInterval: 15_000,
  });
}

export function useHostDetail(hostId: string | null) {
  return useQuery({
    queryKey: ["devops-host", hostId],
    queryFn: () =>
      fetchJson<{ host: DevopsHost; checks: HostCheckRow[] }>(
        `/api/devops/hosts/${hostId}`
      ),
    enabled: !!hostId,
  });
}

export function useCreateHost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      transport: "ssh" | "mock";
      host?: string;
      port?: number;
      user?: string;
      authMethod?: "password" | "key";
      secret?: string;
    }) =>
      fetchJson<{ host: DevopsHost }>("/api/devops/hosts", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["devops-hosts"] }),
  });
}

export function useDeleteHost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ ok: boolean }>(`/api/devops/hosts/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["devops-hosts"] }),
  });
}

export function useValidateHost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ summary: { overall: string; results: StepResultDto[]; fixableSteps: number[] } }>(
        `/api/devops/hosts/${id}/validate`,
        { method: "POST" }
      ),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["devops-hosts"] });
      qc.invalidateQueries({ queryKey: ["devops-host", id] });
    },
  });
}

export function useFixStep(hostId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (step: number) =>
      fetchJson<{ result: StepResultDto }>(`/api/devops/hosts/${hostId}/fix`, {
        method: "POST",
        body: JSON.stringify({ step }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devops-hosts"] });
      qc.invalidateQueries({ queryKey: ["devops-host", hostId] });
    },
  });
}
