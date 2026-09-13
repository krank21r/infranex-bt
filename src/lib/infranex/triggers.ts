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
 *   DEREG_RISK — added by the UID Defense layer (uid-defense.ts); critical
 *                incentive collapses carry a failover plan (DEVOPS-3).
 *   GPU_HEALTH / SUBNET_DRIFT — added by the DevOps monitor (devops-monitor.ts).
 *   ARBITRAGE / RUNTIME_OPT — added by the Miner Mindset strategy pass
 *                (miner-mindset.ts): compute recycling + runtime upgrades.
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
      // TIER2 — an exhausted-ladder ESCALATION resolves when the pod recovers
      // on its own (or after someone fixed it out-of-band).
      const openEsc = await db.triggerEvent.findFirst({
        where: { kind: "ESCALATION", dedupeKey: `${key}:ladder`, status: "open" },
      });
      if (openEsc) {
        await autoResolve("ESCALATION", `${key}:ladder`);
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
    // TIER2 — the repair runs through the escalation ladder: daemon restart,
    // one retry, then a platform tick; only when every rung fails does the
    // operator get an ESCALATION event (with a rollback target when a config
    // revision exists to revert to).
    const { runRepairLadder } = await import("./escalation");
    const ladder = await runRepairLadder(row.deploymentId, { originKind: "RE_SYNC" });
    actionNote = ladder.note;
  } else if (kind === "SCALE") {
    actionNote = "Acknowledged — routed to the Optimization Engine for cheaper configs.";
  } else if (kind === "DEREG_RISK" && row.deploymentId) {
    // DEVOPS-3 — evidence.suggestedAction === "failover" (critical incentive
    // collapse/decline) triggers the experienced-miner reflex: push the
    // fallback serving profile on the GPU + restart, not a bare restart.
    const evidence = safeParse(row.evidenceJson);
    if (evidence.suggestedAction === "failover") {
      const { applyFailoverToGpu } = await import("./miner-mindset");
      try {
        const r = await applyFailoverToGpu(row.deploymentId);
        actionNote = `Applied to GPU — ${r.note}.`;
        if (r.transport === "platform-only") {
          // Still attempt the classic restart so the miner re-syncs — through
          // the escalation ladder so a dead daemon escalates instead of dying
          // quietly here.
          const { runRepairLadder } = await import("./escalation");
          const ladder = await runRepairLadder(row.deploymentId, { originKind: "DEREG_RISK" });
          actionNote += ` ${ladder.note}`;
        }
      } catch (e) {
        actionNote = `Failover apply FAILED: ${
          e instanceof Error ? e.message : "unknown error"
        } — no GPU change was made; check the DevOps board and retry.`;
      }
    } else {
      const { runRepairLadder } = await import("./escalation");
      const ladder = await runRepairLadder(row.deploymentId, { originKind: "DEREG_RISK" });
      actionNote = ladder.note;
    }
  } else if (kind === "ARBITRAGE" && row.deploymentId) {
    // DEVOPS-3 — compute recycling: the engine treats compute as a liquid
    // asset. "recycle" spins the miner down (approval-gated terminate —
    // billing stops, GPU capacity freed for the higher-yield subnet);
    // "evaluate" is advisory and routes to the Optimization Engine.
    const evidence = safeParse(row.evidenceJson);
    const suggested =
      typeof evidence.suggestedAction === "string" ? evidence.suggestedAction : "evaluate";
    if (suggested === "recycle") {
      const target =
        evidence.target && typeof evidence.target === "object"
          ? (evidence.target as Record<string, unknown>)
          : null;
      const targetLabel =
        target && typeof target.netuid === "number" ? ` α${target.netuid}${typeof target.name === "string" ? ` ${target.name}` : ""}` : "";
      const { terminateDeployment } = await import("./deployment/engine");
      await terminateDeployment(row.deploymentId);
      actionNote =
        `Applied to GPU — compute recycled: miner spun down, billing stopped, GPU capacity freed` +
        `${targetLabel ? ` for redeployment on${targetLabel}` : ""}. Re-deploy from the Deployment wizard when ready.`;
    } else {
      actionNote =
        "Acknowledged — no better subnet clears the uplift bar right now; the Optimization Engine keeps ranking alternatives each pass.";
    }
  } else if (kind === "RUNTIME_OPT" && row.deploymentId) {
    // DEVOPS-3 — accelerated serving profile: vLLM/TensorRT-LLM batching,
    // AWQ/EXL2 quantized weights, LoRA fine-tune intent. Implemented on the
    // GPU like drift remediation: env profile merged into the deployment
    // config + apply_config pushed via the daemon (or simulated on mock).
    const evidence = safeParse(row.evidenceJson);
    const recipeIds = Array.isArray(evidence.recipes)
      ? (evidence.recipes as Record<string, unknown>[])
          .map((x) => (typeof x?.id === "string" ? x.id : ""))
          .filter(Boolean)
      : [];
    const { applyRuntimeOptimization } = await import("./miner-mindset");
    try {
      const r = await applyRuntimeOptimization(row.deploymentId, { recipeIds });
      actionNote = `Applied to GPU — ${r.applied.length ? r.applied.join("; ") : "no recipe deltas"}. ${r.note}`;
    } catch (e) {
      actionNote = `GPU runtime apply FAILED: ${
        e instanceof Error ? e.message : "unknown error"
      } — deployment config untouched or partially updated; check the DevOps board and retry after fixing the cause.`;
    }
  } else if (kind === "PROBE_FAIL" && row.deploymentId) {
    // DEVOPS-4 — the synthetic probe found the axon dead: restart the miner
    // so the fresh process re-announces its endpoint on-chain.
    const evidence = safeParse(row.evidenceJson);
    if (evidence.suggestedAction === "restart") {
      const { runRepairLadder } = await import("./escalation");
      const ladder = await runRepairLadder(row.deploymentId, { originKind: "PROBE_FAIL" });
      actionNote = `Applied to GPU — ${ladder.note}`;
    } else {
      actionNote = "Acknowledged — endpoint condition logged; keep monitoring for recurrence.";
    }
  } else if (kind === "SERVICE_LATENCY") {
    // DEVOPS-4 — slow axon: advisory; the fix path is the Runtime Optimizer's
    // accelerated serving profiles (vLLM/TensorRT-LLM/quantization).
    actionNote =
      "Acknowledged — latency logged against the rolling baseline. The Runtime Optimizer's accelerated profiles (vLLM batching, TensorRT-LLM, AWQ/EXL2) are the fix path if it persists.";
  } else if (kind === "QUERY_DROUGHT") {
    // DEVOPS-4 — validators stopped querying: advisory; endpoint probed alive.
    actionNote =
      "Acknowledged — query volume logged. The endpoint answered the probe, so check scoring/selection: validator set changes (Subnet Drift events), serving quality vs cohort, axon re-announce via restart.";
  } else if (kind === "GPU_HEALTH" && row.deploymentId) {
    // DEVOPS-1 — the event's evidence carries the suggested action:
    // "restart" (process down) → daemon restart like RE_SYNC;
    // anything else (thermal, idle GPU, silent daemon) → acknowledge only.
    const evidence = safeParse(row.evidenceJson);
    if (evidence.suggestedAction === "restart") {
      const { runRepairLadder } = await import("./escalation");
      const ladder = await runRepairLadder(row.deploymentId, { originKind: "GPU_HEALTH" });
      actionNote = ladder.note;
    } else {
      actionNote = "Acknowledged — GPU condition logged; keep monitoring for recurrence.";
    }
  } else if (kind === "ESCALATION" && row.deploymentId) {
    // TIER2 — the ladder exhausted every automatic repair. The evidence names
    // the rung plan: "rollback" executes the config rollback to the recorded
    // last known-good revision (restores config + requirements, pushes
    // apply_config via the daemon / ticks mocks); anything else records the
    // escalation and points at KILL as the next rung.
    const evidence = safeParse(row.evidenceJson);
    const targetRev = typeof evidence.targetRev === "number" ? evidence.targetRev : null;
    if (evidence.suggestedAction === "rollback" && targetRev !== null) {
      const { rollbackToRevision } = await import("./deployment/revisions");
      try {
        const r = await rollbackToRevision(row.deploymentId, targetRev, { actor: "engine:escalation" });
        actionNote = `${r.note} Undone: ${r.applied.join("; ") || "no field deltas"}.`;
      } catch (e) {
        actionNote = `Rollback FAILED: ${
          e instanceof Error ? e.message : "unknown error"
        } — the live config was NOT changed; resolve manually from the Deployments view's revision history.`;
      }
    } else {
      actionNote =
        "Escalation recorded — no config revision to revert. If the miner stays down, the next rung is KILL (terminate + stop billing).";
    }
  } else if (kind === "UPSTREAM_DRIFT" && row.deploymentId) {
    // TIER3 — the subnet repo moved after the miner was provisioned.
    // Approval re-pulls the requirements profile onto the GPU — the same
    // implementation path as drift resync (snapshot → regenerate command →
    // apply_config via daemon / tick mocks / platform-only note).
    const { applySubnetConfigToGpu } = await import("./deployment/apply-drift");
    try {
      const r = await applySubnetConfigToGpu(row.deploymentId);
      actionNote = `Applied to GPU — ${
        r.applied.length ? r.applied.join("; ") : "requirements profile refreshed (no config deltas)"
      }. ${r.note}`;
    } catch (e) {
      actionNote = `Upstream resync FAILED: ${
        e instanceof Error ? e.message : "unknown error"
      } — deployment config untouched; check the DevOps board and retry.`;
    }
  } else if (kind === "BENCH_REGRESS") {
    // TIER3 — benchmark regression vs the miner's own rolling baseline:
    // advisory. Latency degradation without probe failure is a serving-
    // quality problem, not a dead process — the Runtime Optimizer's
    // accelerated profiles are the fix path.
    actionNote =
      "Acknowledged — regression logged against the rolling baseline. The Runtime Optimizer's accelerated profiles (vLLM batching, TensorRT-LLM, AWQ/EXL2) are the fix path if it persists.";
  } else if (kind === "SUBNET_DRIFT" && row.deploymentId) {
    // DEVOPS-2 — subnet changes are now IMPLEMENTED on the GPU, not just
    // acknowledged. The event's evidence carries the remediation plan the
    // drift evaluator classified: resync_config (re-pull profile, regenerate
    // miner config, push apply_config via daemon), restart (metagraph
    // re-sync), or evaluate (economics — nothing to change on the GPU).
    const evidence = safeParse(row.evidenceJson);
    const suggested =
      typeof evidence.suggestedAction === "string" ? evidence.suggestedAction : "evaluate";

    if (suggested === "resync_config") {
      const { applySubnetConfigToGpu } = await import("./deployment/apply-drift");
      try {
        const r = await applySubnetConfigToGpu(row.deploymentId);
        actionNote = `Applied to GPU — ${
          r.applied.length ? r.applied.join("; ") : "requirements profile refreshed (no config deltas)"
        }. ${r.note}`;
      } catch (e) {
        actionNote = `GPU apply FAILED: ${
          e instanceof Error ? e.message : "unknown error"
        } — deployment config untouched or partially updated; check the DevOps board and retry after fixing the cause.`;
      }
    } else if (suggested === "restart") {
      // Metagraph shift — restart the miner so it re-syncs + re-announces,
      // through the escalation ladder.
      const { runRepairLadder } = await import("./escalation");
      const ladder = await runRepairLadder(row.deploymentId, { originKind: "SUBNET_DRIFT" });
      actionNote = `Applied to GPU — ${ladder.note}`;
    } else {
      actionNote =
        "Acknowledged — economics drift has no direct GPU change; the Optimization Engine can rank alternatives if the numbers no longer work.";
    }
  } else if (kind === "RUNWAY" && row.deploymentId) {
    // TIER4 / RUNWAY-1 — the immunity T-minus entered the watch/at-risk band.
    // The evidence carries suggestedAction "failover": the same experienced-
    // miner reflex as DEREG_RISK — push the fallback serving profile and
    // restart so income is defended BEFORE the eviction line arrives.
    const evidence = safeParse(row.evidenceJson);
    if (evidence.suggestedAction === "failover") {
      const { applyFailoverToGpu } = await import("./miner-mindset");
      try {
        const r = await applyFailoverToGpu(row.deploymentId);
        actionNote = `Applied to GPU — ${r.note}.`;
        if (r.transport === "platform-only") {
          const { runRepairLadder } = await import("./escalation");
          const ladder = await runRepairLadder(row.deploymentId, { originKind: "RUNWAY" });
          actionNote += ` ${ladder.note}`;
        }
      } catch (e) {
        actionNote = `Runway failover apply FAILED: ${
          e instanceof Error ? e.message : "unknown error"
        } — no GPU change was made; consider migrating the miner to a less saturated subnet instead.`;
      }
    } else {
      actionNote =
        "Acknowledged — runway margins logged. Keep the failover or migration path warm before the immunity window closes.";
    }
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
