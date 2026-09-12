// ---------------------------------------------------------------------------
// Rental → DevOps hand-off (FLOW-1).
//
// One shared bridge used by TWO callers:
//   • POST /api/deployments/[id]/to-devops  (manual button on the card — retry)
//   • the deployment engine's pollProvisioning (AUTOMATIC — the moment a
//     RunPod pod reaches RUNNING, the rented machine is registered as a GPU
//     host with its connect info prefilled; no form, no re-typing)
//
// Security: only the PUBLIC hotkey ever goes to the machine. The SSH private
// key is re-encrypted into the host inventory store and never returned.
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/devops/crypto";
import { ensureDaemon } from "@/lib/infranex/daemon-bridge";
import { serializeSteps, deserializeSteps } from "./state-machine";
import { HOTKEY_ONLY_POLICY_TEXT } from "./ssh-keys";

// NOTE: deliberately NO import from ./engine here — the engine imports this
// bridge (auto hand-off at provisioning-complete), so the dependency must
// stay one-directional. The deployment row is read directly via db.

/** Typed error so the HTTP route can map to the right status code. */
export class BridgeError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface BridgeResult {
  ok: true;
  hostId: string;
  hostName: string;
  daemonRegistered: boolean;
  /** false when a host for this pod already existed (idempotent retry). */
  created: boolean;
  policy: string;
  nextStep: string;
}

/**
 * Register a provisioned RunPod deployment as a managed GPU host in the
 * DevOps Engine inventory. Idempotent: re-running reuses the host for the
 * same pod (and refreshes its key) instead of duplicating.
 */
export async function bridgeDeploymentToDevOps(id: string): Promise<BridgeResult> {
  const dep = await db.deployment.findUnique({ where: { id } });
  if (!dep) throw new BridgeError("Deployment not found", 404);
  if (dep.mode !== "runpod") {
    throw new BridgeError(
      "Only runpod deployments can be registered to DevOps (mock pods have no real host)"
    );
  }
  if (!dep.providerPodId) {
    throw new BridgeError("Deployment has no provisioned pod yet");
  }
  if (!["provisioned", "ready", "deploying", "started"].includes(dep.status)) {
    throw new BridgeError(`Deployment is ${dep.status} — advance it to provisioned first`);
  }

  // Connect info preference: the engine-captured pod IP (freshest, from the
  // same getStatus call that marked the pod RUNNING), then the POD_IP env
  // var stamped into the config, then the pod id placeholder.
  let podIpFromConfig: string | null = null;
  try {
    const cfg = JSON.parse(dep.config) as {
      docker?: { envVars?: { name: string; value: string }[] };
    };
    podIpFromConfig =
      cfg.docker?.envVars?.find((e) => e.name === "POD_IP")?.value ?? null;
  } catch {
    podIpFromConfig = null;
  }
  const hostAddr = dep.sshHost ?? podIpFromConfig ?? dep.providerPodId;

  // The deployment's SSH private key (encrypted) is the host credential.
  // Read the ENCRYPTED key straight from the row — it never enters the
  // public DeploymentRecord shape.
  const depRow = await db.deployment.findUnique({
    where: { id },
    select: { sshPrivKeyEnc: true, sshPublicKey: true },
  });
  if (!depRow?.sshPublicKey) {
    throw new BridgeError("Deployment has no SSH keypair — was it provisioned by provider v2?");
  }
  const privKey = depRow.sshPrivKeyEnc ? decryptSecret(depRow.sshPrivKeyEnc) : null;
  if (!privKey) {
    throw new BridgeError("SSH private key missing for deployment");
  }

  // Reuse an existing host for this pod, else create one.
  const existing = await db.gpuHost.findFirst({
    where: { providerPodId: dep.providerPodId },
  });

  const hostRow = existing
    ? await db.gpuHost.update({
        where: { id: existing.id },
        data: { secretEnc: encryptSecret(privKey), status: "pending" },
      })
    : await db.gpuHost.create({
        data: {
          name: dep.minerName,
          transport: "ssh",
          host: hostAddr,
          port: dep.sshPort ?? 22,
          user: "root",
          secretEnc: encryptSecret(privKey),
          authMethod: "key",
          provider: "runpod",
          providerPodId: dep.providerPodId,
          status: "pending",
        },
      });

  // Register the Node Daemon so the Trigger Engine can reach this host.
  const daemon = await ensureDaemon(dep.id);

  return {
    ok: true,
    hostId: hostRow.id,
    hostName: hostRow.name,
    daemonRegistered: true,
    created: !existing,
    policy: HOTKEY_ONLY_POLICY_TEXT,
    nextStep: "Run the DevOps 10-step validation pipeline on this host.",
  };
}

/**
 * Append an honest one-line note to the deployment's "provision" step log —
 * used by the automatic hand-off to tell the user what happened (success or
 * failure) right where the rental story is already being told. Idempotent.
 */
export async function appendProvisionNote(id: string, line: string): Promise<void> {
  const row = await db.deployment.findUnique({ where: { id }, select: { steps: true } });
  if (!row) return;
  const steps = deserializeSteps(row.steps);
  const prov = steps.find((s) => s.name === "provision");
  if (!prov) return;
  if (prov.output.includes(line)) return;
  prov.output = [...prov.output, line];
  await db.deployment.update({ where: { id }, data: { steps: serializeSteps(steps) } });
}
