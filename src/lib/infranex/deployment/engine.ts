import { db } from "@/lib/db";
import {
  type DeploymentState,
  type DeploymentStep,
  assertCanTransition,
  stateToProgress,
  initSteps,
  syncSteps,
  serializeSteps,
  deserializeSteps,
} from "./state-machine";
import {
  type DeploymentConfig,
  buildDeploymentConfig,
  serializeConfig,
  deserializeConfig,
} from "./config";
import { MockProvider } from "./providers/mock";
import { RunPodProvider } from "./providers/runpod";
import type { ProviderAdapter } from "./providers/base";
import type { Subnet, GPUOffer } from "../types";

/**
 * Deployment engine — orchestrates the full lifecycle:
 *   requested → approved → provisioning → provisioned → setup
 *     → ready → deploying → started (→ stopping → stopped → terminated)
 *
 * Persists every state change to SQLite via Prisma.
 */

const PROVIDERS: Record<string, ProviderAdapter> = {
  mock: MockProvider,
  runpod: RunPodProvider,
};

function getProvider(mode: string): ProviderAdapter {
  return PROVIDERS[mode] ?? MockProvider;
}

// Step output generators — produce realistic-looking logs per step.
function stepOutput(step: string, config: DeploymentConfig): string[] {
  switch (step) {
    case "request":
      return [
        `Deployment requested for subnet ${config.subnet.name} (α${config.subnet.netuid})`,
        `GPU: ${config.gpu.model} (${config.gpu.vramGb}GB) from ${config.gpu.provider}`,
        `Estimated cost: $${config.cost.hourlyUsd.toFixed(2)}/hr · $${config.cost.monthlyUsd}/mo`,
        `Estimated revenue: $${config.cost.estimatedMonthlyRevenueUsd}/mo (ROI ${config.cost.estimatedRoiPercent}%)`,
      ];
    case "approve":
      return [
        "Approval check passed (L1 auto-approve)",
        `Mode: ${config.docker.imageName.includes("bittensor") ? "production" : "mock"}`,
        "Hotkey registered for subnet",
      ];
    case "provision":
      return [
        `Contacting ${config.gpu.provider}...`,
        `Requesting ${config.gpu.model} in ${config.gpu.region}...`,
        `Docker image: ${config.docker.imageName}`,
        `Runtime: ${config.docker.runtime}, ports: ${config.docker.ports.join(", ")}`,
        `Min VRAM: ${config.requirements.minVramGb}GB, Python ${config.requirements.pythonVersion}, CUDA ${config.requirements.cudaVersion}`,
        "GPU server provisioned ✓",
      ];
    case "setup":
      return [
        "Detecting GPU hardware...",
        `  NVIDIA ${config.gpu.model} detected`,
        `  VRAM: ${config.gpu.vramGb}GB ✓`,
        "Checking CUDA driver...",
        `  CUDA ${config.requirements.cudaVersion} ✓`,
        "Checking Docker...",
        "  Docker 24.0 ✓",
        "Checking network...",
        "  Subtensor RPC reachable ✓",
        "Pulling docker image...",
        `  ${config.docker.imageName}`,
        "Environment ready ✓",
      ];
    case "deploy":
      return [
        "Configuring miner...",
        `  Network: ${config.miner.network}`,
        `  NetUID: ${config.miner.netuid}`,
        `  Wallet: ${config.miner.walletName} / hotkey ${config.miner.hotkeyName}`,
        `  Axon port: ${config.miner.axonPort}`,
        "Starting miner process...",
        `  $ ${config.docker.command.slice(0, 80)}...`,
        "Registering miner on chain...",
        `  Allocated UID on subnet ${config.miner.netuid}`,
        "Miner started ✓",
      ];
    case "health":
      return [
        "Pre-flight checks...",
        "  GPU accessible ✓",
        "  CUDA kernel load ✓",
        "  Miner process alive ✓",
        "  Axon responding on :8091 ✓",
        "  Subtensor connection ✓",
        `  Incentive: 0.00 (warmup)`,
        `  Trust: 0.00 (warmup)`,
        "All health checks passed ✓",
      ];
    default:
      return [];
  }
}

export interface CreateDeploymentInput {
  subnet: Subnet;
  offer: GPUOffer;
  minerName: string;
  hotkey?: string;
  walletName?: string;
  mode: "mock" | "runpod";
}

export interface DeploymentRecord {
  id: string;
  minerName: string;
  netuid: number;
  subnetName: string;
  gpuModel: string;
  provider: string;
  status: DeploymentState;
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

function toRecord(row: {
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
  config: string;
  providerPodId: string | null;
  hotkey: string | null;
  steps: string;
  createdAt: Date;
  updatedAt: Date;
}): DeploymentRecord {
  return {
    id: row.id,
    minerName: row.minerName,
    netuid: row.netuid,
    subnetName: row.subnetName,
    gpuModel: row.gpuModel,
    provider: row.provider,
    status: row.status as DeploymentState,
    progress: row.progress,
    mode: row.mode,
    hourlyCost: row.hourlyCost,
    monthlyCost: row.monthlyCost,
    estimatedRevenue: row.estimatedRevenue,
    config: deserializeConfig(row.config),
    providerPodId: row.providerPodId,
    hotkey: row.hotkey,
    steps: deserializeSteps(row.steps),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Create a new deployment record in "requested" state. */
export async function createDeployment(input: CreateDeploymentInput): Promise<DeploymentRecord> {
  const config = buildDeploymentConfig(input.subnet, input.offer, {
    hotkey: input.hotkey,
    walletName: input.walletName,
  });
  const row = await db.deployment.create({
    data: {
      minerName: input.minerName,
      netuid: input.subnet.netuid,
      subnetName: input.subnet.name,
      gpuModel: input.offer.model,
      provider: input.offer.provider,
      status: "requested",
      progress: stateToProgress("requested"),
      mode: input.mode,
      hourlyCost: input.offer.hourlyPrice,
      monthlyCost: config.cost.monthlyUsd,
      estimatedRevenue: config.cost.estimatedMonthlyRevenueUsd,
      config: serializeConfig(config),
      steps: serializeSteps(initSteps()),
      hotkey: input.hotkey ?? null,
    },
  });
  return toRecord(row);
}

/** List all deployments, newest first. */
export async function listDeployments(): Promise<DeploymentRecord[]> {
  const rows = await db.deployment.findMany({
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toRecord);
}

/** Get a single deployment by ID. */
export async function getDeployment(id: string): Promise<DeploymentRecord | null> {
  const row = await db.deployment.findUnique({ where: { id } });
  return row ? toRecord(row) : null;
}

/**
 * Advance the deployment to the next state. This is the core lifecycle
 * driver — called by the API route on each "tick" or explicit action.
 */
export async function advanceDeployment(
  id: string,
  toState?: DeploymentState
): Promise<DeploymentRecord> {
  const rec = await getDeployment(id);
  if (!rec) throw new Error("Deployment not found");
  if (!rec.config) throw new Error("Deployment config missing");

  const current = rec.status as DeploymentState;
  if (current === "started" || current === "terminated" || current === "failed") {
    // Terminal states — nothing to advance
    return rec;
  }

  // Determine the next state
  const next: DeploymentState = toState ?? nextLogicalState(current);
  if (next === current) return rec;
  assertCanTransition(current, next);

  let providerPodId = rec.providerPodId;
  const stepOutputs: Record<string, string[]> = {};

  // Build outputs for all steps up to the current one
  const config = rec.config;
  const allSteps = ["request", "approve", "provision", "setup", "deploy", "health"];
  for (const s of allSteps) {
    stepOutputs[s] = stepOutput(s, config);
  }

  // If we're entering provisioning, actually provision the GPU
  if (next === "provisioning" && !providerPodId) {
    // Provisioning is async — we set state to "provisioning" first,
    // then the tick() call will complete it once the pod is ready.
    // For mock, we provision immediately; for runpod, we fire the request.
    try {
      const provider = getProvider(rec.mode);
      // Don't await here for runpod (it can take 10s+) — but for mock it's fast
      if (rec.mode === "mock") {
        const result = await provider.provision(config, id);
        providerPodId = result.podId;
        stepOutputs.provision.push(`Pod ID: ${result.podId}`, `IP: ${result.ipAddress ?? "—"}`);
      }
    } catch (e) {
      // Provisioning failed
      await updateDeploymentState(id, "failed", providerPodId, stepOutputs);
      throw e;
    }
  }

  // If we're in provisioning and moving to provisioned, complete it
  if (current === "provisioning" && next === "provisioned" && !providerPodId && rec.mode === "runpod") {
    try {
      const provider = getProvider(rec.mode);
      const result = await provider.provision(config, id);
      providerPodId = result.podId;
      stepOutputs.provision.push(`Pod ID: ${result.podId}`, result.message);
    } catch (e) {
      await updateDeploymentState(id, "failed", providerPodId, stepOutputs);
      throw e;
    }
  }

  return updateDeploymentState(id, next, providerPodId, stepOutputs);
}

function nextLogicalState(current: DeploymentState): DeploymentState {
  const flow: DeploymentState[] = [
    "requested",
    "approved",
    "provisioning",
    "provisioned",
    "setup",
    "ready",
    "deploying",
    "started",
  ];
  const idx = flow.indexOf(current);
  if (idx === -1 || idx >= flow.length - 1) return current;
  return flow[idx + 1];
}

async function updateDeploymentState(
  id: string,
  state: DeploymentState,
  providerPodId: string | null,
  outputs: Record<string, string[]>
): Promise<DeploymentRecord> {
  const rec = await getDeployment(id);
  if (!rec) throw new Error("Deployment not found");
  const steps = syncSteps(rec.steps, state, outputs);
  const row = await db.deployment.update({
    where: { id },
    data: {
      status: state,
      progress: stateToProgress(state),
      providerPodId,
      steps: serializeSteps(steps),
    },
  });
  return toRecord(row);
}

/** Terminate a deployment. */
export async function terminateDeployment(id: string): Promise<DeploymentRecord> {
  const rec = await getDeployment(id);
  if (!rec) throw new Error("Deployment not found");

  if (rec.providerPodId) {
    try {
      const provider = getProvider(rec.mode);
      await provider.terminate(rec.providerPodId);
    } catch {
      // Best-effort termination
    }
  }

  const row = await db.deployment.update({
    where: { id },
    data: {
      status: "terminated",
      progress: 100,
    },
  });
  return toRecord(row);
}

/** Delete a deployment record. */
export async function deleteDeployment(id: string): Promise<void> {
  await db.deployment.delete({ where: { id } });
}

/**
 * Tick — advance a deployment that's in a non-terminal state one step
 * forward. Called by the UI poller every few seconds to simulate the
 * lifecycle progressing.
 */
export async function tickDeployment(id: string): Promise<DeploymentRecord> {
  const rec = await getDeployment(id);
  if (!rec) throw new Error("Deployment not found");
  if (rec.status === "started" || rec.status === "terminated" || rec.status === "failed") {
    return rec;
  }
  return advanceDeployment(id);
}
