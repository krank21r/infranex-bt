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
import { generateSshKeypair } from "./ssh-keys";
import { encryptSecret } from "@/lib/devops/crypto";
import {
  bridgeDeploymentToDevOps,
  appendProvisionNote,
} from "./to-devops";
import type { ProviderAdapter } from "./providers/base";
import type { InstallStep } from "@/lib/devops/installer";
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
        "Hotkey & registration come LAST — after the miner runs (step 5 of the wizard)",
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
  sshPublicKey: string | null;
  sshPort: number | null;
  sshHost: string | null;
  installStatus: string | null;
  installSteps: InstallStep[] | null;
  // Registration lifecycle (Phase 2).
  registrationState: "unregistered" | "registered" | null;
  registeredUid: number | null;
  registrationBlock: number | null;
  registrationCheckedAt: string | null;
  restartedAfterRegistration: boolean;
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
  sshPublicKey: string | null;
  sshPort: number | null;
  sshHost: string | null;
  installStatus: string | null;
  installStepsJson: string | null;
  registrationState: string | null;
  registeredUid: number | null;
  registrationBlock: number | null;
  registrationCheckedAt: Date | null;
  restartedAfterRegistration: boolean;
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
    sshPublicKey: row.sshPublicKey,
    sshPort: row.sshPort,
    sshHost: row.sshHost,
    installStatus: row.installStatus,
    installSteps: row.installStepsJson ? (JSON.parse(row.installStepsJson) as InstallStep[]) : null,
    registrationState: (row.registrationState as "unregistered" | "registered" | null) ?? null,
    registeredUid: row.registeredUid,
    registrationBlock: row.registrationBlock,
    registrationCheckedAt: row.registrationCheckedAt ? row.registrationCheckedAt.toISOString() : null,
    restartedAfterRegistration: row.restartedAfterRegistration,
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

  // Canned narrative ONLY for the pre-pod steps. Setup/deploy/health are
  // owned by the real-setup runner (both modes) — its mirrored output lines
  // must survive later advances, so no canned text is ever written for them.
  const config = rec.config;
  for (const s of ["request", "approve", "provision"]) {
    stepOutputs[s] = stepOutput(s, config);
  }

  // Honest headers when a runner-owned phase STARTS; afterwards the runner
  // appends real command output. Absent key = preserve mirrored lines.
  if (next === "setup") {
    stepOutputs.setup = [
      rec.mode === "mock" ? "Connecting to the simulated pod…" : `Connecting to the pod over SSH (${rec.sshHost ?? "ip pending"}:${rec.sshPort ?? 22})…`,
      "Staging the subnet's real install plan (profiler profile + docker/venv path)…",
    ];
  }
  if (next === "deploying") {
    stepOutputs.deploy = [
      "Approval received — checking wallet files and launching the miner…",
    ];
  }

  // Entering provisioning — fire the provider request.
  // mock: completes inline. runpod: kicks off the request, the poller
  // (pollProvisioning) finishes the transition once the pod is RUNNING.
  if (next === "provisioning" && !providerPodId) {
    try {
      if (rec.mode === "mock") {
        const result = await MockProvider.provision(config, id);
        providerPodId = result.podId;
        stepOutputs.provision.push(`Pod ID: ${result.podId}`, `IP: ${result.ipAddress ?? "—"}`);
        return updateDeploymentState(id, next, providerPodId, stepOutputs, null, null, result.ipAddress);
      }
      // runpod — real money path.
      const keypair = generateSshKeypair(`infranex-${id.slice(-8)}`);
      const result = await RunPodProvider.provision(config, id, {
        sshPublicKey: keypair.publicKey,
      });
      providerPodId = result.podId;
      stepOutputs.provision.push(
        `Pod ID: ${result.podId}`,
        result.message,
        `SSH key ${keypair.fingerprint} injected — hotkey-only policy enforced`,
        "Polling until RUNNING…"
      );
      return updateDeploymentState(
        id,
        "provisioning",
        providerPodId,
        stepOutputs,
        keypair.publicKey,
        encryptSecret(keypair.privateKey)
      );
    } catch (e) {
      await updateDeploymentState(id, "failed", providerPodId, stepOutputs);
      throw e;
    }
  }

  return updateDeploymentState(id, next, providerPodId, stepOutputs).then((rec2) => {
    // Fire the real-setup runners AFTER the state row is written.
    if (next === "setup") {
      import("./real-setup")
        .then((m) => m.stageAndRunSetup(id))
        .catch((e) => console.warn(`[engine ${id}] setup kick failed: ${e instanceof Error ? e.message : e}`));
    }
    if (next === "deploying") {
      import("./real-setup").then((m) => m.kickDeploy(id));
    }
    return rec2;
  });
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
  outputs: Record<string, string[]>,
  sshPublicKey?: string | null,
  sshPrivKeyEnc?: string | null,
  ipAddress?: string | null
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
      ...(sshPublicKey !== undefined ? { sshPublicKey } : {}),
      ...(sshPrivKeyEnc !== undefined ? { sshPrivKeyEnc } : {}),
    },
  });
  return toRecord(row);
}

/**
 * Poll a provisioning runpod deployment — called by tickDeployment.
 * When the pod reaches RUNNING, captures IP + SSH port and completes the
 * provisioning step so the lifecycle can advance.
 */
export async function pollProvisioning(id: string): Promise<DeploymentRecord> {
  const rec = await getDeployment(id);
  if (!rec) throw new Error("Deployment not found");
  if (rec.status !== "provisioning" || !rec.providerPodId || rec.mode !== "runpod") {
    return rec;
  }
  try {
    const status = await RunPodProvider.getStatus(rec.providerPodId);
    if (status.status === "running") {
      const sshPort = status.sshPort ?? 22;
      const steps = syncSteps(rec.steps, "provisioned", {
        provision: [
          `Pod RUNNING — IP ${status.ipAddress ?? "pending"}, SSH port ${sshPort}`,
          "Provisioning complete ✓",
        ],
      });
      const row = await db.deployment.update({
        where: { id },
        data: {
          status: "provisioned",
          progress: stateToProgress("provisioned"),
          sshHost: status.ipAddress ?? null,
          sshPort,
          steps: serializeSteps(steps),
        },
      });
      // FLOW-1 — automatic hand-off: the rented pod is registered as a GPU
      // host in the DevOps Engine the moment it is up, with its connect
      // info (IP / mapped SSH port / engine-generated key) prefilled. The
      // user never re-types anything. Best-effort: a failure is logged onto
      // the provision step and the manual "Register to DevOps" button on
      // the deployment card remains the retry path.
      void bridgeDeploymentToDevOps(id)
        .then((r) =>
          appendProvisionNote(
            id,
            `DevOps hand-off: pod registered as GPU host "${r.hostName}" — connect info prefilled in the host inventory.`
          )
        )
        .catch((e) =>
          appendProvisionNote(
            id,
            `DevOps hand-off failed (${e instanceof Error ? e.message : String(e)}) — use "Register to DevOps" on the deployment card to retry.`
          )
        );
      return toRecord(row);
    }
    if (status.status === "terminated" || status.status === "failed") {
      return updateDeploymentState(id, "failed", rec.providerPodId, {});
    }
    return rec; // still pending — keep polling
  } catch {
    // Transient API error — stay in provisioning; next tick retries.
    return rec;
  }
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
 * Public state transition for runner callbacks (real-setup calls this when
 * the deploy phase's verify passes). Skips the tick logic — direct write.
 */
export async function transitionDeployment(
  id: string,
  to: DeploymentState
): Promise<DeploymentRecord> {
  const rec = await getDeployment(id);
  if (!rec) throw new Error("Deployment not found");
  assertCanTransition(rec.status as DeploymentState, to);
  return updateDeploymentState(id, to, rec.providerPodId, {});
}

/**
 * Tick — advance a deployment that's in a non-terminal state one step
 * forward. Called by the UI poller every few seconds to drive the lifecycle.
 * For runpod deployments in provisioning, polls provider status instead.
 *
 * Real-setup guards: while the install runner is mid-flight the tick is a
 * no-op; when it pauses at the wallet gate the tick completes setup → ready;
 * when it failed, an explicit Advance press RE-RUNS the failed phase (retry).
 */
export async function tickDeployment(id: string): Promise<DeploymentRecord> {
  const rec = await getDeployment(id);
  if (!rec) throw new Error("Deployment not found");
  if (rec.status === "started" || rec.status === "terminated" || rec.status === "failed") {
    return rec;
  }
  if (rec.status === "provisioning" && rec.mode === "runpod") {
    return pollProvisioning(id);
  }
  if (rec.status === "setup" || rec.status === "deploying") {
    if (rec.installStatus === "running") return rec; // runner mid-flight
    if (rec.installStatus === "failed") {
      // Explicit Advance = retry the failed phase.
      const m = await import("./real-setup");
      if (rec.status === "setup") {
        await m.retrySetup(id);
      } else {
        m.kickDeploy(id);
      }
      return getDeployment(id).then((r) => r!);
    }
    if (rec.status === "setup" && rec.installStatus === "awaiting_wallet") {
      return advanceDeployment(id, "ready");
    }
    if (rec.status === "deploying" && rec.installStatus === "installed") {
      return advanceDeployment(id, "started");
    }
  }
  return advanceDeployment(id);
}
