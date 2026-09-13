import { db } from "@/lib/db";
import { deserializeConfig, serializeConfig, type DeploymentConfig } from "./config";
import { getDaemonView, enqueueCommand } from "../daemon-bridge";
import { tickDeployment } from "./engine";

/**
 * TIER2 — Deployment config revisions (spec §20/§25 rollback).
 *
 * Every config-mutating action snapshots the PREVIOUS config here BEFORE
 * writing, giving each deployment an append-only revision chain:
 *
 *   r1  deploy          — the config the deployment was created with
 *   r2  drift           — backed up before a SUBNET_DRIFT remediation wrote
 *   r3  runtime-opt     — backed up before a Runtime-Optimizer apply_config
 *   r4  rollback-backup — backed up before an operator rolled back to r2
 *
 * rollbackToRevision restores a revision's config + requirements snapshot and
 * pushes the change to the GPU pod (daemon apply_config / mock tick /
 * platform-only note) — the same transports as drift remediation.
 *
 * The escalation ladder (escalation.ts) reads the chain to point the operator
 * at the newest revision that differs from the live config: "last known-good".
 */

/** Keep the chain bounded — oldest revisions are pruned beyond this. */
export const MAX_REVISIONS_PER_DEPLOYMENT = 20;

export type RevisionCause = "deploy" | "drift" | "runtime-opt" | "rollback-backup" | "migrate";

export interface RevisionDTO {
  id: string;
  rev: number;
  cause: RevisionCause | string;
  note: string;
  actor: string;
  createdAt: string;
  /** Short human summary of the snapshotted config (image + command head). */
  summary: string;
  /** True when this revision's config equals the deployment's CURRENT config. */
  isCurrent: boolean;
}

/**
 * Snapshot the deployment's CURRENT config as the next revision.
 * Call BEFORE mutating Deployment.config. Returns null when the deployment
 * doesn't exist or has no config yet — callers proceed without a chain.
 */
export async function snapshotRevision(
  deploymentId: string,
  cause: RevisionCause,
  note = "",
  actor = "engine"
): Promise<{ rev: number } | null> {
  const row = await db.deployment.findUnique({ where: { id: deploymentId } });
  if (!row || !row.config) return null;

  const last = await db.deploymentRevision.findFirst({
    where: { deploymentId },
    orderBy: { rev: "desc" },
  });
  const rev = (last?.rev ?? 0) + 1;

  await db.deploymentRevision.create({
    data: {
      deploymentId,
      rev,
      cause,
      configJson: row.config,
      requirementsJson: row.requirementsJsonSnapshot,
      note,
      actor,
    },
  });

  await pruneRevisions(deploymentId);
  return { rev };
}

/** Newest-first revision list, annotated with a summary + isCurrent flag. */
export async function listRevisions(deploymentId: string): Promise<RevisionDTO[]> {
  const dep = await db.deployment.findUnique({ where: { id: deploymentId } });
  if (!dep) throw new Error("Deployment not found");

  const rows = await db.deploymentRevision.findMany({
    where: { deploymentId },
    orderBy: { rev: "desc" },
  });

  return rows.map((r) => ({
    id: r.id,
    rev: r.rev,
    cause: r.cause,
    note: r.note,
    actor: r.actor,
    createdAt: r.createdAt.toISOString(),
    summary: summarizeConfig(r.configJson),
    isCurrent: r.configJson === dep.config,
  }));
}

export interface RollbackResult {
  restoredRev: number;
  /** The auto-backup revision capturing what was live before the rollback. */
  backupRev: number | null;
  /** Human-readable config deltas that were undone (current → target). */
  applied: string[];
  transport: "daemon" | "mock" | "platform-only";
  note: string;
}

/**
 * Roll a deployment's config back to a previous revision.
 *
 *   1. Validate: deployment + revision exist, revision differs from live.
 *   2. Auto-backup the live config (cause "rollback-backup") — so a rollback
 *      is itself reversible.
 *   3. Write the revision's config + requirements snapshot onto the
 *      deployment.
 *   4. Push to the GPU: daemon online → apply_config + miner restart;
 *      mock → tick (simulated); real without daemon → platform-side only.
 *
 * Throws with a clear message when the target is missing or identical —
 * callers surface that in the ACTION trail / UI toast.
 */
export async function rollbackToRevision(
  deploymentId: string,
  targetRev: number,
  opts?: { actor?: string }
): Promise<RollbackResult> {
  const dep = await db.deployment.findUnique({ where: { id: deploymentId } });
  if (!dep) throw new Error("Deployment not found");

  const target = await db.deploymentRevision.findUnique({
    where: { deploymentId_rev: { deploymentId, rev: targetRev } },
  });
  if (!target) throw new Error(`Revision r${targetRev} not found for this deployment`);
  if (target.configJson === dep.config) {
    throw new Error(`Already running revision r${targetRev}'s configuration — nothing to roll back`);
  }

  const applied = diffConfigs(dep.config, target.configJson);

  // 2. Auto-backup (skipped when the live config is already snapshotted as the
  //    newest revision — e.g. double rollback where nothing wrote since).
  const newest = await db.deploymentRevision.findFirst({
    where: { deploymentId },
    orderBy: { rev: "desc" },
  });
  let backupRev: number | null = null;
  if (!newest || newest.configJson !== dep.config) {
    const backup = await snapshotRevision(
      deploymentId,
      "rollback-backup",
      `auto-backup before rollback to r${targetRev}`,
      opts?.actor ?? "engine"
    );
    backupRev = backup?.rev ?? null;
  }

  // 3. Restore.
  await db.deployment.update({
    where: { id: deploymentId },
    data: {
      config: target.configJson,
      ...(target.requirementsJson !== null
        ? { requirementsJsonSnapshot: target.requirementsJson }
        : {}),
    },
  });

  // 4. Push to the GPU pod.
  const daemon = await getDaemonView(deploymentId);
  if (daemon && daemon.status !== "unreachable") {
    const cfg = deserializeConfig(target.configJson);
    const env: Record<string, string> = {
      BT_NETUID: String(dep.netuid),
      BT_NETWORK: cfg?.miner.network ?? "finney",
      BT_WALLET_NAME: cfg?.miner.walletName ?? "infranex",
      BT_HOTKEY_NAME: cfg?.miner.hotkeyName ?? "default",
    };
    await enqueueCommand(deploymentId, "apply_config", {
      minerCommand: cfg?.docker.command ?? undefined,
      env,
    });
    return {
      restoredRev: targetRev,
      backupRev,
      applied,
      transport: "daemon",
      note: `Rolled back to r${targetRev} — apply_config queued via node daemon (${daemon.status}); miner restarts under the restored config within 60s.`,
    };
  }

  if (dep.mode === "mock") {
    await tickDeployment(deploymentId).catch(() => null);
    return {
      restoredRev: targetRev,
      backupRev,
      applied,
      transport: "mock",
      note: `Rolled back to r${targetRev} — simulated apply (mock deployment), config + requirements restored platform-side.`,
    };
  }

  return {
    restoredRev: targetRev,
    backupRev,
    applied,
    transport: "platform-only",
    note: `Rolled back to r${targetRev} platform-side — install the Node Daemon on the pod to push apply_config + restart remotely.`,
  };
}

/**
 * Newest revision whose config DIFFERS from the deployment's live config —
 * the escalation ladder's "last known-good" rollback target. Null when the
 * chain is empty or every revision matches the live config.
 */
export async function lastKnownGoodRevision(
  deploymentId: string
): Promise<{ rev: number; cause: string } | null> {
  const dep = await db.deployment.findUnique({ where: { id: deploymentId } });
  if (!dep) return null;
  const rows = await db.deploymentRevision.findMany({
    where: { deploymentId },
    orderBy: { rev: "desc" },
    take: MAX_REVISIONS_PER_DEPLOYMENT,
  });
  const candidate = rows.find((r) => r.configJson !== dep.config);
  return candidate ? { rev: candidate.rev, cause: candidate.cause } : null;
}

/** Prune the chain to the newest MAX_REVISIONS_PER_DEPLOYMENT entries. */
export async function pruneRevisions(deploymentId: string): Promise<number> {
  const rows = await db.deploymentRevision.findMany({
    where: { deploymentId },
    orderBy: { rev: "desc" },
    skip: MAX_REVISIONS_PER_DEPLOYMENT,
  });
  if (!rows.length) return 0;
  const r = await db.deploymentRevision.deleteMany({
    where: { id: { in: rows.map((x) => x.id) } },
  });
  return r.count;
}

/** Human-readable deltas between two serialized configs (a = live, b = target). */
export function diffConfigs(aJson: string, bJson: string): string[] {
  const a = deserializeConfig(aJson);
  const b = deserializeConfig(bJson);
  if (!a || !b) return ["config restored (one side unparseable — full JSON revert)"];
  const out: string[] = [];

  if (a.docker.imageName !== b.docker.imageName) {
    out.push(`image ${a.docker.imageName} → ${b.docker.imageName}`);
  }
  if (a.docker.command !== b.docker.command) out.push("miner command restored");
  if (a.subnet.netuid !== b.subnet.netuid) {
    out.push(`netuid ${a.subnet.netuid} → ${b.subnet.netuid}`);
  }
  if (a.gpu.model !== b.gpu.model) {
    out.push(`gpu ${a.gpu.model} → ${b.gpu.model}`);
  }

  const aEnv = new Map(a.docker.envVars.map((e) => [e.name, e.value]));
  const bEnv = new Map(b.docker.envVars.map((e) => [e.name, e.value]));
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const [k, v] of bEnv) {
    if (!aEnv.has(k)) added.push(k);
    else if (aEnv.get(k) !== v) changed.push(k);
  }
  for (const k of aEnv.keys()) if (!bEnv.has(k)) removed.push(k);
  if (added.length) out.push(`env added: ${added.slice(0, 4).join(", ")}`);
  if (removed.length) out.push(`env removed: ${removed.slice(0, 4).join(", ")}`);
  if (changed.length) out.push(`env changed: ${changed.slice(0, 4).join(", ")}`);

  if (a.requirements.pythonVersion !== b.requirements.pythonVersion) {
    out.push(`python ${a.requirements.pythonVersion} → ${b.requirements.pythonVersion}`);
  }
  if (a.requirements.cudaVersion !== b.requirements.cudaVersion) {
    out.push(`cuda ${a.requirements.cudaVersion} → ${b.requirements.cudaVersion}`);
  }
  if (a.requirements.minVramGb !== b.requirements.minVramGb) {
    out.push(`min vram ${a.requirements.minVramGb}GB → ${b.requirements.minVramGb}GB`);
  }

  return out.length ? out : ["config bytes differ (no field-level deltas detected)"];
}

function summarizeConfig(configJson: string): string {
  const cfg: DeploymentConfig | null = (() => {
    try {
      return deserializeConfig(configJson);
    } catch {
      return null;
    }
  })();
  if (!cfg) return "unparseable config";
  const cmd = cfg.docker.command.replace(/\s+/g, " ").slice(0, 60);
  return `${cfg.docker.imageName} · α${cfg.subnet.netuid} · ${cmd}${cmd.length >= 60 ? "…" : ""}`;
}

/** Serialize helper re-exported for tests (keeps one canonical JSON shape). */
export { serializeConfig };
