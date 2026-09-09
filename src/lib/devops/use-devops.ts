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

export interface LatestInstallSummary {
  id: string;
  netuid: number;
  subnetName: string;
  status: string;
  updatedAt: string;
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
  latestInstall?: LatestInstallSummary | null;
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

// ---------------------------------------------------------------------------
// Subnet Requirements Profiler + Requirement Installer
// ---------------------------------------------------------------------------

export interface SubnetRequirementsProfile {
  netuid: number;
  subnetName: string;
  description: string | null;
  category: string | null;
  minVramGb: number;
  recommendedGpu: string;
  gpuSource: "repo" | "classifier" | "revenue-est" | "curated";
  osPackages: string[];
  pythonVersion: string | null;
  pipPackages: string[];
  pipPackageCount: number;
  gitDeps: string[];
  cudaMinVersion: string | null;
  dockerImage: string | null;
  dockerRequired: boolean;
  bittensorStack: string[];
  packageManager: "pip" | "uv";
  repoUrl: string | null;
  repoBranch: string;
  entrypoint: string | null;
  readmeUrl: string | null;
  requirementsUrl: string | null;
  dockerfileFound: boolean;
  chainNetwork: "finney";
  ports: { axon: number; prometheus: number };
  envKeys: { name: string; description: string; required: boolean }[];
  minerCommandTemplate: string;
  sources: ("chain" | "github" | "curated")[];
  confidence: "high" | "medium" | "low";
  notes: string[];
  fetchedAt: string;
}

export function useSubnetRequirements(netuid: number | null, refresh = false) {
  return useQuery({
    queryKey: ["subnet-requirements", netuid, refresh],
    queryFn: () =>
      fetchJson<{ profile: SubnetRequirementsProfile; cached: boolean }>(
        `/api/devops/subnet-requirements?netuid=${netuid}${refresh ? "&refresh=1" : ""}`
      ),
    enabled: netuid !== null,
    staleTime: 5 * 60 * 1000,
  });
}

export interface InstallStepDto {
  id: string;
  idx: number;
  title: string;
  description: string;
  gate: "auto" | "approval" | "manual";
  commands: string[];
  virtual?: boolean;
  status: "pending" | "running" | "pass" | "fail" | "skipped";
  output: string;
  remediation: string | null;
  durationMs: number;
}

export interface HostInstallDto {
  id: string;
  hostId: string;
  netuid: number;
  subnetName: string;
  walletName: string;
  hotkeyName: string;
  status: "staged" | "running" | "waiting_approval" | "deployed" | "failed" | "stopped";
  profile: SubnetRequirementsProfile | null;
  steps: InstallStepDto[];
  createdAt: string;
  updatedAt: string;
}

export function useHostInstall(hostId: string | null) {
  return useQuery({
    queryKey: ["devops-install", hostId],
    queryFn: () =>
      fetchJson<{ install: HostInstallDto | null }>(`/api/devops/hosts/${hostId}/install`),
    enabled: !!hostId,
    refetchInterval: 8_000,
  });
}

export function useStageInstall(hostId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { netuid: number; walletName: string; hotkeyName: string }) =>
      fetchJson<{ install: HostInstallDto }>(`/api/devops/hosts/${hostId}/install`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devops-hosts"] });
      qc.invalidateQueries({ queryKey: ["devops-install", hostId] });
    },
  });
}

export function useRunInstallStep(hostId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ stepId, action }: { stepId: string; action?: "run" | "override" }) =>
      fetchJson<{ install: { id: string; status: string }; step: InstallStepDto }>(
        `/api/devops/hosts/${hostId}/install/steps/${stepId}`,
        { method: "POST", body: JSON.stringify({ action: action ?? "run" }) }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devops-hosts"] });
      qc.invalidateQueries({ queryKey: ["devops-install", hostId] });
    },
  });
}

export function useStopInstall(hostId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchJson<{ ok: boolean; output: string }>(`/api/devops/hosts/${hostId}/install/stop`, {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devops-hosts"] });
      qc.invalidateQueries({ queryKey: ["devops-install", hostId] });
    },
  });
}

/** Subnet options for the deploy picker — from the live network snapshot. */
export interface DeploySubnetOption {
  netuid: number;
  name: string;
  gpuRequired: string;
  minVramGb: number;
  category: string;
  minersCount: number;
}

export function useDeploySubnetOptions() {
  return useQuery({
    queryKey: ["deploy-subnet-options"],
    queryFn: async () => {
      const j = await fetchJson<{
        subnets?: {
          netuid: number;
          name: string;
          gpuRequired: string;
          minVramGb: number;
          category: string;
          minersCount: number;
        }[];
      }>("/api/devops/subnet-options");
      return j.subnets ?? [];
    },
    staleTime: 60_000,
  });
}
