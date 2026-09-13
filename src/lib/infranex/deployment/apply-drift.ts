import { db } from "@/lib/db";
import {
  pullSubnetRequirements,
  type SubnetRequirementsProfile,
} from "@/lib/devops/subnet-requirements";
import { deserializeConfig } from "./config";
import { getDaemonView, enqueueCommand } from "../daemon-bridge";
import { tickDeployment } from "./engine";

/**
 * DEVOPS-2 — implement subnet changes ON the GPU.
 *
 * When the DevOps monitor detects subnet drift (hyperparameters, metagraph,
 * repo requirements) and the operator approves the SUBNET_DRIFT event, this
 * module closes the loop:
 *
 *   1. Re-pull the subnet's requirements profile (fresh from chain + repo).
 *   2. Diff it against the profile snapshot the miner was deployed with.
 *   3. Update the deployment: requirements snapshot + regenerated miner
 *      command (entrypoint from the new profile, wallet/hotkey/ports kept).
 *   4. Push the change to the GPU pod:
 *        - daemon online  → apply_config command (rewrites the miner command
 *          on the host, persists it across daemon restarts, restarts miner)
 *        - mock mode      → deployment tick (simulated apply, recorded)
 *        - real, no daemon→ platform-side only + install-daemon note
 *
 * The applied change list flows back into the trigger event's ACTION note —
 * the DevOps view's change feed becomes the audit trail of what was
 * implemented on which GPU, when.
 */

export interface ApplyDriftResult {
  /** Short note for the trigger ACTION trail. */
  note: string;
  /** Concrete config deltas that were written (empty = snapshot refresh only). */
  applied: string[];
  /** Where the change was pushed: "daemon" | "mock" | "platform-only". */
  transport: "daemon" | "mock" | "platform-only";
}

type ProfileFetcher = typeof pullSubnetRequirements;

/** Diff the deployed profile against a fresh one — human-readable deltas. */
export function diffProfiles(
  oldProfile: SubnetRequirementsProfile | null,
  fresh: SubnetRequirementsProfile
): string[] {
  const out: string[] = [];
  if (!oldProfile) {
    out.push("requirements profile initialised (none stored at deploy time)");
    return out;
  }
  if (oldProfile.entrypoint !== fresh.entrypoint) {
    out.push(`entrypoint ${oldProfile.entrypoint ?? "—"} → ${fresh.entrypoint ?? "—"}`);
  }
  if (oldProfile.minerCommandTemplate !== fresh.minerCommandTemplate) {
    out.push("miner command template changed");
  }
  if (oldProfile.pythonVersion !== fresh.pythonVersion) {
    out.push(`python ${oldProfile.pythonVersion ?? "—"} → ${fresh.pythonVersion ?? "—"}`);
  }
  if (oldProfile.dockerImage !== fresh.dockerImage) {
    out.push(`docker image ${oldProfile.dockerImage ?? "—"} → ${fresh.dockerImage ?? "—"}`);
  }
  if (oldProfile.repoBranch !== fresh.repoBranch) {
    out.push(`repo branch ${oldProfile.repoBranch} → ${fresh.repoBranch}`);
  }
  const oldPkg = new Set(oldProfile.osPackages);
  const newPkg = new Set(fresh.osPackages);
  const added = [...newPkg].filter((p) => !oldPkg.has(p));
  const removed = [...oldPkg].filter((p) => !newPkg.has(p));
  if (added.length) out.push(`os packages added: ${added.slice(0, 5).join(", ")}${added.length > 5 ? "…" : ""}`);
  if (removed.length) out.push(`os packages removed: ${removed.slice(0, 5).join(", ")}${removed.length > 5 ? "…" : ""}`);
  if (oldProfile.pipPackageCount !== fresh.pipPackageCount) {
    out.push(`python deps ${oldProfile.pipPackageCount} → ${fresh.pipPackageCount} packages`);
  }
  if (oldProfile.ports.axon !== fresh.ports.axon || oldProfile.ports.prometheus !== fresh.ports.prometheus) {
    out.push(`ports axon ${oldProfile.ports.axon}→${fresh.ports.axon}, prometheus ${oldProfile.ports.prometheus}→${fresh.ports.prometheus}`);
  }
  const oldEnv = new Set(oldProfile.envKeys.map((e) => e.name));
  const newEnvKeys = fresh.envKeys.filter((e) => e.required && !oldEnv.has(e.name));
  if (newEnvKeys.length) {
    out.push(`new required env keys: ${newEnvKeys.slice(0, 4).map((e) => e.name).join(", ")}`);
  }
  if (oldProfile.cudaMinVersion !== fresh.cudaMinVersion) {
    out.push(`cuda min ${oldProfile.cudaMinVersion ?? "—"} → ${fresh.cudaMinVersion ?? "—"}`);
  }
  return out;
}

/** Substitute <WALLET>/<HOTKEY> placeholders into the profile's template. */
function concreteMinerCommand(
  template: string,
  walletName: string,
  hotkeyName: string,
  netuid: number
): string {
  return template
    .replace(/<WALLET>/g, walletName)
    .replace(/<HOTKEY>/g, hotkeyName)
    .replace(/<NETUID>/g, String(netuid))
    .replace(/</g, "")
    .replace(/>/g, "");
}

/**
 * Apply the current subnet requirements to a deployed GPU miner.
 * Throws when the deployment doesn't exist or the fresh profile can't be
 * pulled — the caller (trigger executor) records the failure in the event.
 */
export async function applySubnetConfigToGpu(
  deploymentId: string,
  opts?: { fetchProfile?: ProfileFetcher }
): Promise<ApplyDriftResult> {
  const row = await db.deployment.findUnique({ where: { id: deploymentId } });
  if (!row) throw new Error("Deployment not found");

  const fetchProfile = opts?.fetchProfile ?? pullSubnetRequirements;
  const { profile: fresh } = await fetchProfile(row.netuid, { refresh: true });

  const oldProfile = row.requirementsJsonSnapshot
    ? safeParseProfile(row.requirementsJsonSnapshot)
    : null;
  const applied = diffProfiles(oldProfile, fresh);

  // --- Platform-side state: snapshot + regenerated miner command ---------
  // TIER2 — snapshot the live config BEFORE the drift remediation writes, so
  // the pre-drift state is one rollback away.
  const cfg = deserializeConfig(row.config);
  const walletName = cfg?.miner.walletName ?? "infranex";
  const hotkeyName = cfg?.miner.hotkeyName ?? "default";
  let newCommand: string | null = null;

  if (cfg) {
    newCommand = concreteMinerCommand(fresh.minerCommandTemplate, walletName, hotkeyName, row.netuid);
    if (newCommand && newCommand !== cfg.docker.command) {
      const { snapshotRevision } = await import("./revisions");
      await snapshotRevision(
        deploymentId,
        "drift",
        applied.length ? `before drift remediation: ${applied.slice(0, 3).join("; ")}` : "before drift remediation",
        "engine"
      ).catch(() => null);
      cfg.docker.command = newCommand;
      if (fresh.pythonVersion) cfg.requirements.pythonVersion = fresh.pythonVersion;
      if (fresh.cudaMinVersion) cfg.requirements.cudaVersion = fresh.cudaMinVersion;
      cfg.requirements.minVramGb = fresh.minVramGb;
      await db.deployment.update({
        where: { id: deploymentId },
        data: { config: JSON.stringify(cfg) },
      });
    } else {
      newCommand = null; // command unchanged — nothing to push for it
    }
  }

  await db.deployment.update({
    where: { id: deploymentId },
    data: { requirementsJsonSnapshot: JSON.stringify(fresh) },
  });

  // --- Push to the GPU pod ------------------------------------------------
  const daemon = await getDaemonView(deploymentId);
  if (daemon && daemon.status !== "unreachable") {
    const env: Record<string, string> = {
      BT_NETUID: String(row.netuid),
      BT_NETWORK: "finney",
      BT_WALLET_NAME: walletName,
      BT_HOTKEY_NAME: hotkeyName,
    };
    await enqueueCommand(deploymentId, "apply_config", {
      minerCommand: newCommand ?? undefined,
      env,
    });
    return {
      note: `apply_config queued via node daemon (${daemon.status}) — miner restarts under the new subnet config within 60s`,
      applied,
      transport: "daemon",
    };
  }

  if (row.mode === "mock") {
    await tickDeployment(deploymentId).catch(() => null);
    return {
      note: "simulated apply (mock deployment) — config + requirements snapshot updated, no real pod",
      applied,
      transport: "mock",
    };
  }

  return {
    note: "config updated platform-side — install the Node Daemon on the pod to push apply_config + restart remotely",
    applied,
    transport: "platform-only",
  };
}

function safeParseProfile(s: string): SubnetRequirementsProfile | null {
  try {
    const v = JSON.parse(s) as SubnetRequirementsProfile;
    return v && typeof v === "object" && Array.isArray(v.osPackages) ? v : null;
  } catch {
    return null;
  }
}
