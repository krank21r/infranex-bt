import { db } from "@/lib/db";
import { approveTrigger, actOnTrigger } from "./triggers";
import type { TriggerKind } from "./triggers-core";

/**
 * TIER3 — Autopilot policy engine.
 *
 * The trigger engine already PROPOSES actions and executes them only after
 * a human approves (approve → act, the ONLY deployment-mutating path).
 * Autopilot adds a policy layer on top: operator-defined rules that let the
 * engine approve + execute matching OPEN events itself, so routine
 * remediation no longer waits for a human — while destructive actions stay
 * human-only, every auto-execution is stamped into the event's evidence,
 * and the change feed remains the full audit trail.
 *
 * Safety model (defence in depth):
 *   1. HARD denylist — KILL and ESCALATION events are NEVER auto-acted,
 *      regardless of any rule. Same for ARBITRAGE "recycle" suggestions
 *      (they terminate the deployment). Escalations exist precisely because
 *      automatic repair failed; auto-acting them would loop.
 *   2. Rate limit — maxPerHour per rule (rolling hour, counted from the
 *      evidence stamps this engine writes), so a flapping condition can't
 *      machine-gun the GPU.
 *   3. Severity floor — a rule only matches events at/above its
 *      minSeverity (info < warning < critical).
 *   4. Open only — approved events were approved by a human for a human
 *      context; autopilot never re-acts on them, and it acts on an event
 *      at most once (approve → act in one pass).
 */

// Kinds autopilot must never execute, whatever any rule says.
const NEVER_AUTO_KINDS: ReadonlySet<string> = new Set(["KILL", "ESCALATION"]);

const SEVERITY_RANK: Record<string, number> = { info: 0, warning: 1, critical: 2 };

export interface AutopilotRuleDTO {
  id: string;
  name: string;
  kind: string;
  minSeverity: string;
  maxPerHour: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toRuleDTO(row: {
  id: string;
  name: string;
  kind: string;
  minSeverity: string;
  maxPerHour: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}): AutopilotRuleDTO {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    minSeverity: row.minSeverity,
    maxPerHour: row.maxPerHour,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Pure rule matcher — exported so tests classify EXACTLY like the engine. */
export function ruleMatches(
  rule: { kind: string; minSeverity: string; enabled: boolean },
  event: { kind: string; severity: string; evidence: Record<string, unknown> }
): { match: boolean; reason: string } {
  if (!rule.enabled) return { match: false, reason: "rule disabled" };
  if (NEVER_AUTO_KINDS.has(event.kind))
    return { match: false, reason: `kind ${event.kind} is human-only (denylist)` };
  if (
    event.kind === "ARBITRAGE" &&
    typeof event.evidence.suggestedAction === "string" &&
    event.evidence.suggestedAction === "recycle"
  )
    return { match: false, reason: "recycle suggestion terminates a deployment — human-only" };
  if (rule.kind !== "ANY" && rule.kind !== event.kind)
    return { match: false, reason: `kind ${event.kind} != rule ${rule.kind}` };
  if (
    (SEVERITY_RANK[event.severity] ?? 0) < (SEVERITY_RANK[rule.minSeverity] ?? 1)
  )
    return { match: false, reason: `severity ${event.severity} below rule floor ${rule.minSeverity}` };
  return { match: true, reason: "ok" };
}

// ---------------------------------------------------------------------------
// Rate limiting (durable — counted from this engine's own evidence stamps)
// ---------------------------------------------------------------------------

const RATE_WINDOW_MS = 60 * 60 * 1000;

async function actionsInLastHour(ruleId: string, now: number): Promise<number> {
  const since = new Date(now - RATE_WINDOW_MS);
  return db.triggerEvent.count({
    where: {
      status: "acted",
      updatedAt: { gte: since },
      // The stamp this engine writes: evidence.auto.ruleId === "<id>".
      evidenceJson: { contains: `"ruleId":"${ruleId}"` },
    },
  });
}

function stampEvidence(
  raw: string,
  stamp: { ruleId: string; ruleName: string; at: string }
): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return JSON.stringify({ ...parsed, auto: stamp });
  } catch {
    return JSON.stringify({ auto: stamp });
  }
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

export interface AutopilotAction {
  eventId: string;
  kind: string;
  ruleId: string;
  ruleName: string;
  actionNote: string;
}

export interface AutopilotPassResult {
  evaluatedAt: string;
  openEvents: number;
  rules: number;
  acted: AutopilotAction[];
  skipped: { eventId: string; kind: string; reason: string }[];
}

export interface AutopilotPassOptions {
  now?: Date;
  /** DI: override the rule list (tests). */
  rules?: { id: string; name: string; kind: string; minSeverity: string; maxPerHour: number; enabled: boolean }[];
  /** DI: override the open-event list (tests). */
  events?: {
    id: string;
    kind: string;
    severity: string;
    evidenceJson: string;
    deploymentId: string | null;
  }[];
}

export async function runAutopilotPass(
  opts?: AutopilotPassOptions
): Promise<AutopilotPassResult> {
  const now = opts?.now ?? new Date();
  const rules = opts?.rules ?? (await db.autopilotRule.findMany({ orderBy: { createdAt: "asc" } }));
  const events =
    opts?.events ??
    (await db.triggerEvent.findMany({
      where: { status: "open" },
      orderBy: { createdAt: "asc" },
      take: 100,
    }));

  const result: AutopilotPassResult = {
    evaluatedAt: now.toISOString(),
    openEvents: events.length,
    rules: rules.length,
    acted: [],
    skipped: [],
  };

  for (const event of events) {
    const evidence = safeParseEvidence(event.evidenceJson);

    // Most specific match wins: exact-kind rules before ANY rules.
    const candidates = rules
      .map((rule) => ({ rule, m: ruleMatches(rule, { kind: event.kind, severity: event.severity, evidence }) }))
      .filter((c) => c.m.match)
      .sort((a, b) => (a.rule.kind === event.kind ? 0 : 1) - (b.rule.kind === event.kind ? 0 : 1));

    if (!candidates.length) {
      // Nothing matched — silence is the normal case (no event spam).
      continue;
    }
    const chosen = candidates[0];

    const used = await actionsInLastHour(chosen.rule.id, now.getTime());
    if (used >= chosen.rule.maxPerHour) {
      result.skipped.push({
        eventId: event.id,
        kind: event.kind,
        reason: `rate limit — ${used}/${chosen.rule.maxPerHour} actions in the last hour for rule "${chosen.rule.name}"`,
      });
      continue;
    }

    try {
      await approveTrigger(event.id);
      const { action } = await actOnTrigger(event.id);
      // Stamp the evidence so the change feed shows WHO acted (which rule)
      // and the rate limiter can count durably.
      await db.triggerEvent.update({
        where: { id: event.id },
        data: {
          evidenceJson: stampEvidence(event.evidenceJson, {
            ruleId: chosen.rule.id,
            ruleName: chosen.rule.name,
            at: now.toISOString(),
          }),
        },
      });
      result.acted.push({
        eventId: event.id,
        kind: event.kind,
        ruleId: chosen.rule.id,
        ruleName: chosen.rule.name,
        actionNote: action,
      });
    } catch (e) {
      result.skipped.push({
        eventId: event.id,
        kind: event.kind,
        reason: `act failed: ${e instanceof Error ? e.message : "unknown error"}`,
      });
    }
  }

  return result;
}

function safeParseEvidence(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
