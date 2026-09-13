import { db } from "@/lib/db";
import { commitFinding, type TriggerKind } from "./triggers-core";
import { lastKnownGoodRevision, type RevisionDTO } from "./deployment/revisions";

/**
 * TIER2 — Escalation ladder for repair actions (spec §25).
 *
 * Before Tier 2, a repair action executed once: if the daemon restart threw,
 * the event's ACTION note said "failed, check the provider console" and the
 * human was back to square one. The ladder makes the engine try progressively
 * more forceful repairs on its own BEFORE bothering the operator:
 *
 *   rung 1  restart_via_daemon        — queue restart_miner (the gentle fix)
 *   rung 2  restart_via_daemon_retry  — one retry after a short backoff
 *   rung 3  tick_deployment           — transport fallback (mock / platform tick)
 *   rung 4  escalate_to_human         — open an ESCALATION trigger event with
 *                                       the full ladder trace + a one-click
 *                                       rollback target when a config revision
 *                                       exists to go back to.
 *
 * Every rung is recorded (LadderStep) and the trace lands in the ACTION note
 * of the original event plus, on exhaustion, in the ESCALATION event's
 * evidence — the DevOps change feed becomes the audit trail.
 */

export interface LadderStep {
  rung: number;
  action: string;
  ok: boolean;
  detail: string;
  at: string;
}

export interface LadderResult {
  /** Some rung succeeded — no human needed. */
  resolved: boolean;
  /** All repair rungs failed and an ESCALATION event was committed. */
  escalated: boolean;
  steps: LadderStep[];
  /** Summary for the original event's ACTION note. */
  note: string;
  escalationEventId?: string;
}

export interface LadderRung {
  action: string;
  run: () => Promise<string>;
}

const DEFAULT_DELAY_MS = 1_500;

/** Default repair ladder: daemon restart → retry → tick → escalate. */
export async function runRepairLadder(
  deploymentId: string,
  opts?: {
    /** Override the rung list (tests / non-restart repairs). */
    rungs?: LadderRung[];
    /** Backoff between rungs; tests pass 0. */
    delayMs?: number;
    /** Extra context stored on the ESCALATION event when exhausted. */
    originKind?: TriggerKind | string;
  }
): Promise<LadderResult> {
  const delayMs = opts?.delayMs ?? DEFAULT_DELAY_MS;
  const rungs: LadderRung[] = opts?.rungs ?? [
    {
      action: "restart_via_daemon",
      run: async () => {
        const { restartViaDaemon } = await import("./daemon-bridge");
        return restartViaDaemon(deploymentId);
      },
    },
    {
      action: "restart_via_daemon_retry",
      run: async () => {
        const { restartViaDaemon } = await import("./daemon-bridge");
        return restartViaDaemon(deploymentId);
      },
    },
    {
      action: "tick_deployment",
      run: async () => {
        const { tickDeployment } = await import("./deployment/engine");
        await tickDeployment(deploymentId);
        return "deployment ticked — platform-side re-sync applied";
      },
    },
  ];

  const steps: LadderStep[] = [];
  for (let i = 0; i < rungs.length; i++) {
    const rung = rungs[i];
    if (i > 0 && delayMs > 0) await sleep(delayMs);
    try {
      const detail = await rung.run();
      steps.push({ rung: i + 1, action: rung.action, ok: true, detail, at: new Date().toISOString() });
      return {
        resolved: true,
        escalated: false,
        steps,
        note: `Ladder: resolved at rung ${i + 1} (${rung.action}) — ${detail}`,
      };
    } catch (e) {
      steps.push({
        rung: i + 1,
        action: rung.action,
        ok: false,
        detail: e instanceof Error ? e.message : "unknown error",
        at: new Date().toISOString(),
      });
    }
  }

  // Exhausted — hand the operator a loaded decision, not a blank error.
  const esc = await commitEscalation(deploymentId, steps, opts?.originKind);
  return {
    resolved: false,
    escalated: true,
    steps,
    note:
      `Ladder exhausted after ${steps.length} repair rungs — escalated to operator` +
      (esc.suggestedAction === "rollback"
        ? ` with a one-click rollback to r${esc.targetRev} (last known-good config).`
        : "; no config revision to roll back to, KILL is the next rung."),
    escalationEventId: esc.eventId,
  };
}

export interface EscalationCommit {
  eventId: string;
  result: "created" | "refreshed" | "exists";
  suggestedAction: "rollback" | "kill" | "review";
  targetRev: number | null;
}

/**
 * Commit the ESCALATION trigger event for a deployment whose automatic
 * repairs are exhausted. Deduped on `${deploymentId}:ladder` among OPEN
 * events — repeat exhaustions refresh the trace instead of spamming.
 *
 * Evidence carries:
 *   ladder        — the recorded rung attempts (what the engine already tried)
 *   originKind    — which trigger's repair failed
 *   suggestedAction — "rollback" when a config revision differs from live,
 *                     else "kill" (nothing to revert — pod is the problem)
 *   targetRev     — the rollback revision number (when rollback suggested)
 *   targetCause   — what created that revision (drift / runtime-opt / deploy)
 */
export async function commitEscalation(
  deploymentId: string,
  steps: LadderStep[],
  originKind?: TriggerKind | string
): Promise<EscalationCommit> {
  const dep = await db.deployment.findUnique({ where: { id: deploymentId } });
  const good = await lastKnownGoodRevision(deploymentId);

  const suggestedAction: EscalationCommit["suggestedAction"] = good
    ? "rollback"
    : dep
      ? "kill"
      : "review";

  const evidence: Record<string, unknown> = {
    ladder: steps,
    originKind: originKind ?? null,
    suggestedAction,
    targetRev: good?.rev ?? null,
    targetCause: good?.cause ?? null,
    minerName: dep?.minerName ?? null,
    mode: dep?.mode ?? null,
  };

  const tried = steps.map((s) => `${s.rung}.${s.action}✗`).join(" → ");
  const title =
    suggestedAction === "rollback"
      ? `Escalate "${dep?.minerName ?? deploymentId}" — repairs failed, roll back to r${good?.rev}?`
      : `Escalate "${dep?.minerName ?? deploymentId}" — automatic repairs exhausted`;

  const detail =
    `The engine tried ${steps.length} automatic repair rungs (${tried}) and all failed. ` +
    (suggestedAction === "rollback"
      ? `Config revision r${good?.rev} (${good?.cause}) differs from the live config — approving executes the rollback and pushes apply_config to the GPU.`
      : dep
        ? "No config revision exists to revert — the pod itself is the problem; the next rung is KILL (terminate + stop billing)."
        : "Deployment record missing — review manually.");

  const runbook =
    suggestedAction === "rollback"
      ? [
          "Check the ladder trace below — what did each rung report?",
          `Approve to roll back to r${good?.rev} (config restored + apply_config pushed to the GPU).`,
          "If the miner is healthy again after rollback, the change that broke it stays identified and undone.",
          "If it still fails on the old config, the problem is the pod — KILL is the next rung.",
        ]
      : [
          "Confirm the pod is truly unreachable (provider console, daemon heartbeat).",
          "Approve this event to record the escalation, then open a KILL event if it stays down.",
        ];

  const result = await commitFinding({
    kind: "ESCALATION",
    severity: "critical",
    dedupeKey: `${deploymentId}:ladder`,
    title,
    detail,
    evidence,
    deploymentId,
    netuid: dep?.netuid ?? null,
    runbook,
  });

  const row = await db.triggerEvent.findFirst({
    where: { kind: "ESCALATION", dedupeKey: `${deploymentId}:ladder`, status: "open" },
    orderBy: { updatedAt: "desc" },
  });

  return {
    eventId: row?.id ?? "",
    result,
    suggestedAction,
    targetRev: good?.rev ?? null,
  };
}

/** Revision list shape re-exported for the ESCALATION act path. */
export type { RevisionDTO };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
