import { db } from "@/lib/db";
import { fetchMonitoringOverview } from "./monitoring";
import {
  type TriggerKind,
  type TriggerEventDTO,
  toDTO,
  safeParse,
  safeArray,
  commitFinding,
  autoResolve,
} from "./triggers-core";

export { TRIGGER_KIND_META, type TriggerEventDTO } from "./triggers-core";

/**
 * Trigger Engine v1 — scheduled evaluations that PROPOSE actions.
 *
 * Every action is APPROVAL-GATED: the engine only creates events; a human
 * approves, and only then does the action execute. One open event per
 * (kind, dedupeKey) — repeated findings refresh the evidence instead of
 * spamming. Recovery auto-resolves open events.
 *
 * Kinds:
 *   RE_SYNC  — pod is down / not running for consecutive passes.
 *   SCALE    — mining at a clear loss (cost >> revenue), consider switching.
 *   KILL     — escalation: re-sync already acted, pod STILL down → terminate.
 *   DEREG_RISK — added by the UID Defense layer (uid-defense.ts).
 */

// ---------------------------------------------------------------------------
// Consecutive-pass counters (in-memory; evidence also persisted per event)
// ---------------------------------------------------------------------------

interface PassState {
  podDownPasses: Map<string, number>;
  lossPasses: Map<string, number>;
  lastRunAt: number | null;
}

const globalForTriggers = globalThis as unknown as {
  __infranexTriggerPass: PassState | undefined;
};

const pass: PassState =
  globalForTriggers.__infranexTriggerPass ??
  (globalForTriggers.__infranexTriggerPass = {
    podDownPasses: new Map(),
    lossPasses: new Map(),
    lastRunAt: null,
  });

const POD_DOWN_THRESHOLD = 2; // consecutive passes before proposing RE_SYNC
const LOSS_THRESHOLD = 3; // consecutive passes of clear loss before SCALE

// ---------------------------------------------------------------------------
// Evaluators
// ---------------------------------------------------------------------------

export interface PassResult {
  evaluatedAt: string;
  deploymentsEvaluated: number;
  created: number;
  refreshed: number;
  resolved: number;
  findings: { kind: TriggerKind; action: string; deploymentId?: string }[];
}

/** Run one evaluation pass across all started deployments. */
export async function runTriggerPass(): Promise<PassResult> {
  const overview = await fetchMonitoringOverview();
  const result: PassResult = {
    evaluatedAt: new Date().toISOString(),
    deploymentsEvaluated: 0,
    created: 0,
    refreshed: 0,
    resolved: 0,
    findings: [],
  };

  for (const dep of overview.deployments) {
    if (dep.status !== "started") continue;
    result.deploymentsEvaluated++;
    const key = dep.id;

    const pod = dep.monitoring.pod;
    const isMock = dep.mode === "mock";
    const podDown = !isMock && (!pod.exists || (pod.desiredStatus !== null && pod.desiredStatus !== "RUNNING"));

    // ---- RE_SYNC / KILL: pod down -------------------------------------
    if (podDown) {
      const downPasses = (pass.podDownPasses.get(key) ?? 0) + 1;
      pass.podDownPasses.set(key, downPasses);

      // Escalation: an RE_SYNC was already acted on and it's STILL down.
      const actedSync = await db.triggerEvent.findFirst({
        where: { kind: "RE_SYNC", dedupeKey: key, status: "acted" },
        orderBy: { updatedAt: "desc" },
      });

      if (actedSync && downPasses >= POD_DOWN_THRESHOLD) {
        const r = await commitFinding({
          kind: "KILL",
          severity: "critical",
          dedupeKey: key,
          title: `Kill "dep.minerName" — still down after re-sync`,
          detail: `Pod has been down for ${downPasses} consecutive passes and a RE_SYNC was already executed. Burning money with no incentive — approval will terminate the pod.`,
          evidence: {
            podDownPasses: downPasses,
            desiredStatus: pod.desiredStatus,
            podExists: pod.exists,
            publicIp: pod.publicIp,
            escalatedFrom: actedSync.id,
            monitoredAt: overview.fetchedAt,
          },
          deploymentId: dep.id,
          netuid: dep.netuid,
          runbook: [
            "Confirm the pod is truly unrecoverable (logs, provider console).",
            "Approve to terminate the pod and stop billing.",
            "Re-register the hotkey on a fresh deployment if desired.",
          ],
        });
        if (r === "created") result.created++;
        else if (r === "refreshed") result.refreshed++;
        result.findings.push({ kind: "KILL", action: r, deploymentId: dep.id });
      } else if (downPasses >= POD_DOWN_THRESHOLD) {
        const r = await commitFinding({
          kind: "RE_SYNC",
          severity: "warning",
          dedupeKey: key,
          title: `Re-sync "${dep.minerName}" — pod not running`,
          detail: `Pod ${dep.providerPodId ?? "?"} desired status is ${pod.desiredStatus ?? "unknown"} for ${downPasses} passes. Approval will attempt a miner restart via the DevOps daemon.`,
          evidence: {
            podDownPasses: downPasses,
            podExists: pod.exists,
            desiredStatus: pod.desiredStatus,
            providerPodId: dep.providerPodId,
            monitoredAt: overview.fetchedAt,
          },
          deploymentId: dep.id,
          netuid: dep.netuid,
          runbook: [
            "Check pod logs in the provider console for crash loops.",
            "Approve to restart the miner process (daemon) or re-tick the deployment.",
            "If it stays down after re-sync, the engine will propose KILL.",
          ],
        });
        if (r === "created") result.created++;
        else if (r === "refreshed") result.refreshed++;
        result.findings.push({ kind: "RE_SYNC", action: r, deploymentId: dep.id });
      }
    } else {
      // Recovery — clear counters and resolve open events.
      if (pass.podDownPasses.get(key)) {
        pass.podDownPasses.delete(key);
        await autoResolve("RE_SYNC", key);
        result.resolved++;
      }
      const openKill = await db.triggerEvent.findFirst({
        where: { kind: "KILL", dedupeKey: key, status: "open" },
      });
      if (openKill) {
        await autoResolve("KILL", key);
        result.resolved++;
      }
    }

    // ---- SCALE: mining at a clear loss --------------------------------
    const cost = dep.monitoring.rewards.costPerMonthUsd ?? dep.monthlyCost;
    const revenue = dep.monitoring.rewards.emissionPerMonthUsd ?? 0;
    const chainKnown = dep.monitoring.chain.found;
    const clearLoss = chainKnown && cost > revenue * 2 && revenue < cost * 0.5;

    if (clearLoss) {
      const lossPasses = (pass.lossPasses.get(key) ?? 0) + 1;
      pass.lossPasses.set(key, lossPasses);
      if (lossPasses >= LOSS_THRESHOLD) {
        const r = await commitFinding({
          kind: "SCALE",
          severity: "info",
          dedupeKey: key,
          title: `Consider scaling "${dep.minerName}" — mining at a loss`,
          detail: `Monthly cost $${cost.toFixed(0)} vs estimated revenue $${revenue.toFixed(0)} over ${lossPasses} passes. No destructive action — approval marks the decision and routes you to the Optimization Engine.`,
          evidence: {
            lossPasses,
            costPerMonthUsd: cost,
            revenuePerMonthUsd: revenue,
            incentive: dep.monitoring.chain.incentive,
            monitoredAt: overview.fetchedAt,
          },
          deploymentId: dep.id,
          netuid: dep.netuid,
          runbook: [
            "Open the Optimization Engine for cheaper hardware / better subnets.",
            "Consider switching subnet (hotkey swap) instead of burning capital.",
            "Approve to acknowledge and silence this event for 24h.",
          ],
        });
        if (r === "created") result.created++;
        else if (r === "refreshed") result.refreshed++;
        result.findings.push({ kind: "SCALE", action: r, deploymentId: dep.id });
      }
    } else if (pass.lossPasses.get(key)) {
      pass.lossPasses.delete(key);
      await autoResolve("SCALE", key);
      result.resolved++;
    }
  }

  pass.lastRunAt = Date.now();
  return result;
}

// ---------------------------------------------------------------------------
// Human actions — approve / dismiss / act
// ---------------------------------------------------------------------------

export async function approveTrigger(id: string): Promise<TriggerEventDTO> {
  const row = await db.triggerEvent.findUnique({ where: { id } });
  if (!row) throw new Error("Trigger event not found");
  if (row.status !== "open") throw new Error(`Event is ${row.status}, not open`);
  const updated = await db.triggerEvent.update({
    where: { id },
    data: { status: "approved" },
  });
  return toDTO(updated);
}

export async function dismissTrigger(id: string): Promise<TriggerEventDTO> {
  const row = await db.triggerEvent.findUnique({ where: { id } });
  if (!row) throw new Error("Trigger event not found");
  if (row.status !== "open") throw new Error(`Event is ${row.status}, not open`);
  const updated = await db.triggerEvent.update({
    where: { id },
    data: { status: "dismissed", resolvedAt: new Date() },
  });
  return toDTO(updated);
}

/**
 * Execute the action behind an approved trigger. This is the ONLY path that
 * mutates a deployment — and it requires status === "approved".
 */
export async function actOnTrigger(id: string): Promise<{ event: TriggerEventDTO; action: string }> {
  const row = await db.triggerEvent.findUnique({ where: { id } });
  if (!row) throw new Error("Trigger event not found");
  if (row.status !== "approved") throw new Error(`Event is ${row.status} — approve first`);

  const kind = row.kind as TriggerKind;
  let actionNote = "";

  if (kind === "KILL" && row.deploymentId) {
    const { terminateDeployment } = await import("./deployment/engine");
    await terminateDeployment(row.deploymentId);
    actionNote = "Deployment terminated (pod destroyed, billing stopped).";
  } else if (kind === "RE_SYNC" && row.deploymentId) {
    // Try the DevOps daemon first; fall back to a deployment tick for mock.
    const { restartViaDaemon } = await import("./daemon-bridge");
    const dep = row.deploymentId;
    try {
      actionNote = await restartViaDaemon(dep);
    } catch {
      actionNote = "No daemon reachable — deployment ticked for re-sync; check provider console.";
      const { tickDeployment } = await import("./deployment/engine");
      await tickDeployment(dep).catch(() => null);
    }
  } else if (kind === "SCALE") {
    actionNote = "Acknowledged — routed to the Optimization Engine for cheaper configs.";
  } else if (kind === "DEREG_RISK" && row.deploymentId) {
    const { restartViaDaemon } = await import("./daemon-bridge");
    actionNote = await restartViaDaemon(row.deploymentId);
  } else {
    actionNote = "No action bound to this event.";
  }

  const updated = await db.triggerEvent.update({
    where: { id },
    data: { status: "acted", detail: `${row.detail}\n\nACTION: ${actionNote}`, resolvedAt: new Date() },
  });
  return { event: toDTO(updated), action: actionNote };
}

export async function listTriggerEvents(): Promise<{
  open: TriggerEventDTO[];
  recent: TriggerEventDTO[];
}> {
  const open = await db.triggerEvent.findMany({
    where: { status: { in: ["open", "approved"] } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const recent = await db.triggerEvent.findMany({
    where: { status: { in: ["acted", "dismissed", "resolved"] } },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
  return { open: open.map(toDTO), recent: recent.map(toDTO) };
}
