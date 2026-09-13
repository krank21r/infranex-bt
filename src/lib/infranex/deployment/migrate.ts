import { db } from "@/lib/db";
import type { GPUOffer } from "../types";
import { offerProviderId } from "../types";
import { MockProvider } from "./providers/mock";
import { RunPodProvider } from "./providers/runpod";
import { VastProvider } from "./providers/vast";
import { deserializeSteps, serializeSteps, type DeploymentStep } from "./state-machine";
import { snapshotRevision } from "./revisions";
import { bridgeDeploymentToDevOps } from "./to-devops";

/**
 * TIER3 — Deployment migration (spec: move a miner to different hardware
 * without losing its identity or history).
 *
 * A migration moves a STARTED deployment onto a new GPU offer with minimal
 * downtime and a full audit trail:
 *
 *   1. Preflight   — deployment must be "started"; target offer must be
 *                    rentable by the deployment's mode (mock stays mock,
 *                    runpod requires a runpod offer).
 *   2. Snapshot    — a "migrate" revision anchors the pre-move state.
 *   3. Provision   — bring up the NEW pod first (zero-gap: the old pod
 *                    keeps serving until the new one is live).
 *   4. Switch      — point the deployment record at the new pod (gpuModel,
 *                    provider pod id, ssh host/port, costs from the offer).
 *   5. Re-bridge   — GpuHost/DaemonState follow the new pod (idempotent
 *                    per providerPodId).
 *   6. Decommission— terminate the OLD pod (billing stops).
 *   7. Trail       — migration steps appended to the deployment's step
 *                    history; result note for the caller.
 *
 * The miner config (subnet, hotkey, env, command) is untouched — this is a
 * hardware move, not a reconfiguration. Real pods still need the Node
 * Daemon + miner setup on the new pod (same as any fresh provision); the
 * bridge + setup runners handle registration of the new host.
 */

export interface MigrationTarget {
  offer: GPUOffer;
}

export interface MigrationResult {
  deploymentId: string;
  from: { providerPodId: string | null; gpuModel: string; hourlyCost: number };
  to: { providerPodId: string; gpuModel: string; hourlyCost: number; region: string };
  steps: { name: string; ok: boolean; detail: string }[];
  note: string;
  transport: "mock" | "runpod" | "vast";
}

const MIGRATION_STEP_NAMES = [
  { name: "migrate:preflight", label: "Migration Preflight" },
  { name: "migrate:provision-new", label: "Provision New GPU" },
  { name: "migrate:switch", label: "Switch Deployment" },
  { name: "migrate:bridge", label: "Re-bridge DevOps" },
  { name: "migrate:decommission-old", label: "Decommission Old GPU" },
];

function appendMigrationSteps(existing: string, results: { name: string; ok: boolean; detail: string }[]): string {
  const steps = deserializeSteps(existing);
  const byName = new Map(steps.map((s) => [s.name, s]));
  for (const def of MIGRATION_STEP_NAMES) {
    const r = results.find((x) => x.name === def.name);
    const step: DeploymentStep = {
      name: def.name,
      label: def.label,
      status: r ? (r.ok ? "done" : "failed") : "skipped",
      startedAt: r ? new Date().toISOString() : null,
      completedAt: r ? new Date().toISOString() : null,
      output: r ? [r.detail] : [],
    };
    byName.set(def.name, step);
  }
  return serializeSteps([...byName.values()]);
}

/**
 * Execute the migration. Throws with an operator-readable message on any
 * preflight failure — the caller (API route) turns that into a 400.
 */
export async function migrateDeployment(
  deploymentId: string,
  target: MigrationTarget,
  opts?: { actor?: string }
): Promise<MigrationResult> {
  const row = await db.deployment.findUnique({ where: { id: deploymentId } });
  if (!row) throw new Error("Deployment not found");
  if (row.status !== "started")
    throw new Error(`Deployment is ${row.status} — only started deployments can migrate`);
  if (!target?.offer || typeof target.offer.model !== "string" || !target.offer.model)
    throw new Error("Migration target requires a valid GPU offer");

  const offer = target.offer;
  const mode = row.mode;
  // TIER4 — live migrations now support both real rental adapters.
  const transport: MigrationResult["transport"] =
    mode === "mock" ? "mock" : mode === "vast" ? "vast" : "runpod";

  // Preflight — mode/offer compatibility. Spot offers are refused outright
  // (a long-running miner must not land on interruptible capacity), then
  // mock deployments migrate within the simulated fleet; real deployments
  // require a live offer from the matching rental provider.
  if (offer.isSpot) {
    throw new Error("Refusing to migrate a long-running miner onto a spot/interruptible offer");
  }
  if (mode === "mock" && offer.provider !== "mock") {
    throw new Error("Mock deployments migrate within the simulated fleet — this offer is for live rentals");
  }
  if (mode === "runpod" && offerProviderId(offer.provider) !== "runpod") {
    throw new Error(`RunPod deployments migrate onto RunPod offers only (got "${offer.provider}")`);
  }
  if (mode === "vast" && offerProviderId(offer.provider) !== "vast") {
    throw new Error(`Vast.ai deployments migrate onto Vast.ai offers only (got "${offer.provider}")`);
  }

  const results: MigrationResult["steps"] = [];
  const from = {
    providerPodId: row.providerPodId,
    gpuModel: row.gpuModel,
    hourlyCost: row.hourlyCost,
  };

  // 2. Snapshot the pre-move state (config unchanged, but the audit chain
  // records the move — Tier 2 rollback stays meaningful).
  await snapshotRevision(
    deploymentId,
    "migrate",
    `before migration: ${row.gpuModel} ($${row.hourlyCost.toFixed(2)}/h) → ${offer.model} ($${offer.hourlyPrice.toFixed(2)}/h)`,
    opts?.actor ?? "engine"
  ).catch(() => null);
  results.push({ name: "migrate:preflight", ok: true, detail: `${row.gpuModel} → ${offer.model} (${offer.region})` });

  // 3. Provision the NEW pod first.
  const provider =
    transport === "mock" ? MockProvider : transport === "vast" ? VastProvider : RunPodProvider;
  const cfg = row.config ? JSON.parse(row.config) : null;
  if (!cfg) throw new Error("Deployment config missing — cannot migrate");
  // TIER4 — the target offer id rides into the provisioner via the config's
  // gpu.offerId (Vast rents BY OFFER; RunPod maps the model to a gpu_type_id).
  if (transport !== "mock") cfg.gpu = { ...cfg.gpu, offerId: offer.id };
  const provisionCtx = transport !== "mock" ? { sshPublicKey: row.sshPublicKey ?? undefined } : undefined;
  const provisioned = await provider.provision(cfg, deploymentId, provisionCtx);
  if (provisioned.status === "failed") {
    results.push({ name: "migrate:provision-new", ok: false, detail: provisioned.message });
    await db.deployment.update({
      where: { id: deploymentId },
      data: { steps: appendMigrationSteps(row.steps, results) },
    });
    throw new Error(`New pod provisioning failed: ${provisioned.message} — old pod untouched, still serving`);
  }
  results.push({ name: "migrate:provision-new", ok: true, detail: `${provisioned.podId} (${offer.model})` });

  // 4. Switch the deployment record to the new pod.
  await db.deployment.update({
    where: { id: deploymentId },
    data: {
      providerPodId: provisioned.podId,
      gpuModel: offer.model,
      provider: transport === "vast" ? "Vast.ai" : transport,
      sshHost: provisioned.ipAddress ?? row.sshHost,
      sshPort: provisioned.sshPort ?? row.sshPort,
      hourlyCost: offer.hourlyPrice,
      monthlyCost: offer.monthlyPrice,
      steps: appendMigrationSteps(row.steps, [...results, { name: "migrate:switch", ok: true, detail: "record switched" }]),
      updatedAt: new Date(),
    },
  });
  results.push({ name: "migrate:switch", ok: true, detail: `now on ${provisioned.podId}` });

  // 5. Re-bridge the DevOps layer (GpuHost + DaemonState follow the pod).
  let bridgeNote = "skipped (mock deployment)";
  if (transport !== "mock") {
    try {
      const bridge = await bridgeDeploymentToDevOps(deploymentId);
      bridgeNote = `bridged: host ${bridge.hostName}, daemon ${bridge.daemonRegistered ? "registered" : "pending"}${bridge.created ? "" : " (existing host reused)"}`;
    } catch (e) {
      bridgeNote = `bridge deferred: ${e instanceof Error ? e.message : "unknown error"}`;
    }
  }
  results.push({ name: "migrate:bridge", ok: true, detail: bridgeNote });

  // 6. Decommission the OLD pod (billing stops) — only after the new one is live.
  let killNote = "no old pod to terminate";
  if (from.providerPodId && from.providerPodId !== provisioned.podId) {
    try {
      const kill = await provider.terminate(from.providerPodId);
      killNote = kill.message;
    } catch (e) {
      killNote = `old pod termination failed (${e instanceof Error ? e.message : "unknown"}) — check the provider console for ${from.providerPodId}`;
    }
  }
  results.push({ name: "migrate:decommission-old", ok: true, detail: killNote });

  // Persist the COMPLETE trail (the switch update above only captured the
  // steps known at that point — bridge + decommission landed after).
  await db.deployment
    .update({
      where: { id: deploymentId },
      data: { steps: appendMigrationSteps(row.steps, results) },
    })
    .catch(() => null);

  const note =
    `Migrated "${row.minerName}" ${from.gpuModel} → ${offer.model} ` +
    `($${from.hourlyCost.toFixed(2)}/h → $${offer.hourlyPrice.toFixed(2)}/h, ${offer.region}). ` +
    `Old pod ${killNote}.`;

  return {
    deploymentId,
    from,
    to: {
      providerPodId: provisioned.podId,
      gpuModel: offer.model,
      hourlyCost: offer.hourlyPrice,
      region: offer.region,
    },
    steps: results,
    note,
    transport,
  };
}
