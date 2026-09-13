import { db } from "@/lib/db";

/**
 * Trigger Engine core — shared by the standard evaluators (RE-SYNC / SCALE /
 * KILL) and the UID Defense layer (DEREG-RISK). Holds the event types, the
 * dedupe-aware commit, and auto-resolution.
 */

export type TriggerKind =
  | "RE_SYNC"
  | "SCALE"
  | "KILL"
  | "DEREG_RISK"
  | "GPU_HEALTH"
  | "SUBNET_DRIFT"
  | "ARBITRAGE"
  | "RUNTIME_OPT"
  | "PROBE_FAIL"
  | "SERVICE_LATENCY"
  | "QUERY_DROUGHT"
  | "ESCALATION"
  // TIER3 — committed by the upstream watcher (upstream.ts) when the
  // subnet repo moves (new release tag / new commit) after the deployment
  // was provisioned: the operator gets prev→latest and one-click resync.
  | "UPSTREAM_DRIFT"
  // TIER3 — committed by the benchmark harness (benchmarks.ts) when the
  // latest axon-latency run regressed vs the rolling baseline.
  | "BENCH_REGRESS"
  // TIER4 / RUNWAY-1 — committed by the immunity-runway pass (runway.ts)
  // when the eviction T-minus enters the watch/at-risk bands (pre-expiry
  // warning; the live EVICTABLE state stays owned by DEREG_RISK).
  | "RUNWAY";

export const TRIGGER_KIND_META: Record<
  TriggerKind,
  { label: string; severity: "info" | "warning" | "critical"; color: string }
> = {
  RE_SYNC: { label: "Re-Sync", severity: "warning", color: "amber" },
  SCALE: { label: "Scale", severity: "info", color: "sky" },
  KILL: { label: "Kill", severity: "critical", color: "red" },
  DEREG_RISK: { label: "Dereg Risk", severity: "critical", color: "violet" },
  // DEVOPS-1 — emitted by the scheduled DevOps monitor (devops-monitor.ts).
  GPU_HEALTH: { label: "GPU Health", severity: "warning", color: "orange" },
  SUBNET_DRIFT: { label: "Subnet Drift", severity: "info", color: "cyan" },
  // DEVOPS-3 — emitted by the Miner Mindset strategy pass (miner-mindset.ts):
  // the engine reasons like an experienced mining firm — compute is liquid,
  // runtimes are tunable, and validators decide the income.
  ARBITRAGE: { label: "Arbitrage", severity: "warning", color: "emerald" },
  RUNTIME_OPT: { label: "Runtime Opt", severity: "warning", color: "fuchsia" },
  // DEVOPS-4 — Service Health & Validator Traffic (service-health.ts):
  // the engine measures what validators measure — endpoint latency and
  // whether queries are actually arriving.
  PROBE_FAIL: { label: "Probe Fail", severity: "critical", color: "red" },
  SERVICE_LATENCY: { label: "Service Latency", severity: "warning", color: "yellow" },
  QUERY_DROUGHT: { label: "Query Drought", severity: "warning", color: "rose" },
  // TIER2 — committed by the escalation ladder (escalation.ts) when every
  // automatic repair rung failed: the operator gets the ladder trace plus a
  // one-click rollback target (last known-good config revision) when one exists.
  ESCALATION: { label: "Escalation", severity: "critical", color: "red" },
  // TIER3 — upstream repo moved after deploy (upstream.ts).
  UPSTREAM_DRIFT: { label: "Upstream", severity: "warning", color: "indigo" },
  // TIER3 — benchmark run regressed vs rolling baseline (benchmarks.ts).
  BENCH_REGRESS: { label: "Bench Regress", severity: "warning", color: "teal" },
  // TIER4 — immunity runway T-minus entered the watch/at-risk band (runway.ts).
  RUNWAY: { label: "Runway", severity: "critical", color: "lime" },
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
        title: input.title,
        runbookJson: JSON.stringify(input.runbook),
        severity: input.severity,
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
  // TIER4 — external alerting: fire-and-forget webhook dispatch on NEW
  // conditions only (refreshes must not re-page every 90s pass). The
  // dispatcher never throws — a broken webhook must not break a pass.
  void (async () => {
    try {
      const { dispatchAlertEvent } = await import("./alerts");
      await dispatchAlertEvent({
        kind,
        severity: input.severity,
        title: input.title,
        detail: input.detail,
        deploymentId: input.deploymentId ?? null,
        netuid: input.netuid ?? null,
      });
    } catch {
      /* alerting must never break the evaluator path */
    }
  })();
  return "created";
}

/** Close open events because the condition recovered. Returns the count. */
export async function autoResolve(kind: TriggerKind, dedupeKey: string): Promise<number> {
  const r = await db.triggerEvent.updateMany({
    where: { kind, dedupeKey, status: "open" },
    data: { status: "resolved", resolvedAt: new Date() },
  });
  return r.count;
}
