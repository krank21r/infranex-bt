import { db } from "@/lib/db";

/**
 * Trigger Engine core — shared by the standard evaluators (RE-SYNC / SCALE /
 * KILL) and the UID Defense layer (DEREG-RISK). Holds the event types, the
 * dedupe-aware commit, and auto-resolution.
 */

export type TriggerKind = "RE_SYNC" | "SCALE" | "KILL" | "DEREG_RISK";

export const TRIGGER_KIND_META: Record<
  TriggerKind,
  { label: string; severity: "info" | "warning" | "critical"; color: string }
> = {
  RE_SYNC: { label: "Re-Sync", severity: "warning", color: "amber" },
  SCALE: { label: "Scale", severity: "info", color: "sky" },
  KILL: { label: "Kill", severity: "critical", color: "red" },
  DEREG_RISK: { label: "Dereg Risk", severity: "critical", color: "violet" },
};

export interface TriggerEventDTO {
  id: string;
  kind: TriggerKind;
  severity: string;
  status: "open" | "approved" | "acted" | "dismissed" | "resolved";
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
  deploymentId: string | null;
  netuid: number | null;
  runbook: string[];
  createdAt: string;
  resolvedAt: string | null;
}

export function toDTO(row: {
  id: string;
  kind: string;
  severity: string;
  status: string;
  title: string;
  detail: string;
  evidenceJson: string;
  deploymentId: string | null;
  netuid: number | null;
  runbookJson: string;
  createdAt: Date;
  resolvedAt: Date | null;
}): TriggerEventDTO {
  return {
    id: row.id,
    kind: row.kind as TriggerKind,
    severity: row.severity,
    status: row.status as TriggerEventDTO["status"],
    title: row.title,
    detail: row.detail,
    evidence: safeParse(row.evidenceJson),
    deploymentId: row.deploymentId,
    netuid: row.netuid,
    runbook: safeArray(row.runbookJson),
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

export function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

export function safeArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Commit a finding — deduped by (kind, dedupeKey) among OPEN events:
 *   "created"   new open event
 *   "refreshed" existing open event got fresh evidence
 *   "exists"    open event untouched (same evidence)
 */
export async function commitFinding(input: {
  kind: TriggerKind;
  severity: "info" | "warning" | "critical";
  dedupeKey: string;
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
  deploymentId?: string | null;
  netuid?: number | null;
  runbook: string[];
}): Promise<"created" | "refreshed" | "exists"> {
  const { kind, dedupeKey } = input;
  const existing = await db.triggerEvent.findFirst({
    where: { kind, dedupeKey, status: "open" },
  });
  if (existing) {
    await db.triggerEvent.update({
      where: { id: existing.id },
      data: {
        evidenceJson: JSON.stringify(input.evidence),
        detail: input.detail,
        updatedAt: new Date(),
      },
    });
    return "refreshed";
  }
  await db.triggerEvent.create({
    data: {
      kind,
      severity: input.severity,
      status: "open",
      title: input.title,
      detail: input.detail,
      evidenceJson: JSON.stringify(input.evidence),
      dedupeKey,
      deploymentId: input.deploymentId ?? null,
      netuid: input.netuid ?? null,
      runbookJson: JSON.stringify(input.runbook),
    },
  });
  return "created";
}

/** Close open events because the condition recovered. */
export async function autoResolve(kind: TriggerKind, dedupeKey: string): Promise<void> {
  await db.triggerEvent.updateMany({
    where: { kind, dedupeKey, status: "open" },
    data: { status: "resolved", resolvedAt: new Date() },
  });
}
