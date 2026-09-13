import { db } from "@/lib/db";
import { fetchMonitoringOverview } from "./monitoring";

/**
 * TIER4 — AI Ops Agent. One LLM run over a compact, number-dense digest of
 * the live fleet state: per-miner vitals (incentive, net profit, ROI, UID
 * risk), the open trigger events, and fleet economics. The agent ranks what
 * matters and tags every recommendation [auto-safe] (policy-gated autopilot
 * territory) or [needs-approval] (the Recommendations inbox) — it NEVER
 * executes anything itself; execution paths stay exactly the ones the
 * engine already gates.
 *
 * z-ai-web-dev-sdk is backend-only. The completion function is injectable
 * so tests exercise the context builder + persistence deterministically.
 */

export interface FleetContextMiner {
  name: string;
  netuid: number;
  subnet: string;
  gpu: string;
  mode: string;
  provider: string;
  status: string;
  hourlyCost: number;
  incentive: number | null;
  emissionPerMonthUsd: number | null;
  netProfitPerMonthUsd: number | null;
  roiPercent: number | null;
  uidRisk: string | null;
  riskCodes: string[];
  registeredUid: number | null;
}

export interface FleetContext {
  miners: FleetContextMiner[];
  openEvents: { kind: string; severity: string; title: string; miner: string | null }[];
  economics: { infraPerDay: number; revenuePerDay: number; netPerDay: number };
  counts: { monitored: number; openCritical: number; openWarning: number };
}

/** Build the compact fleet digest the agent reasons over. DB + cached chain. */
export async function buildFleetContext(): Promise<FleetContext> {
  const overview = await fetchMonitoringOverview();
  const started = overview.deployments.filter((d) => d.status === "started");

  // Latest UID snapshot per started deployment (risk level + codes) — one
  // cheap DB read; the snapshots are written by the 90s UID-defense pass.
  const ids = started.map((d) => d.id);
  const uidRows = ids.length
    ? await db.uidSnapshot.findMany({
        where: { deploymentId: { in: ids } },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const latestUid = new Map<string, (typeof uidRows)[number]>();
  for (const r of uidRows) {
    if (!latestUid.has(r.deploymentId)) latestUid.set(r.deploymentId, r);
  }

  const miners: FleetContextMiner[] = started.map((d) => ({
    name: d.minerName,
    netuid: d.netuid,
    subnet: d.subnetName,
    gpu: d.gpuModel,
    mode: d.mode,
    provider: d.provider,
    status: d.status,
    hourlyCost: Math.round(((d.monitoring.rewards.costPerMonthUsd ?? d.monthlyCost) / 30) * 1000) / 1000,
    incentive: d.monitoring.chain.incentive,
    emissionPerMonthUsd: d.monitoring.rewards.emissionPerMonthUsd,
    netProfitPerMonthUsd: d.monitoring.rewards.netProfitPerMonthUsd,
    roiPercent: d.monitoring.rewards.roiPercent,
    uidRisk: latestUid.get(d.id)?.riskLevel ?? null,
    riskCodes: latestUid.get(d.id)
      ? (JSON.parse(latestUid.get(d.id)!.riskCodesJson) as string[])
      : [],
    registeredUid: latestUid.get(d.id)?.uid ?? null,
  }));

  const openRows = await db.triggerEvent.findMany({
    where: { status: { in: ["open", "approved"] } },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const nameById = new Map(started.map((d) => [d.id, d.minerName]));
  const openEvents = openRows.map((e) => ({
    kind: e.kind,
    severity: e.severity,
    title: e.title,
    miner: e.deploymentId ? nameById.get(e.deploymentId) ?? null : null,
  }));

  const infraPerDay = started.reduce((a, d) => a + (d.monitoring.rewards.costPerMonthUsd ?? d.monthlyCost), 0) / 30;
  const revenuePerDay = started.reduce((a, d) => a + (d.monitoring.rewards.emissionPerDayUsd ?? 0), 0);

  return {
    miners,
    openEvents,
    economics: {
      infraPerDay,
      revenuePerDay,
      netPerDay: revenuePerDay - infraPerDay,
    },
    counts: {
      monitored: started.length,
      openCritical: openEvents.filter((e) => e.severity === "critical").length,
      openWarning: openEvents.filter((e) => e.severity === "warning").length,
    },
  };
}

const SYSTEM_PROMPT = `You are the Infranex Ops Agent — a senior Bittensor mining operations engineer embedded in a GPU fleet control room.

You receive a JSON digest of the live fleet: per-miner vitals (incentive, monthly emission USD, net profit, ROI, UID deregistration risk), the currently OPEN trigger events from the 90-second DevOps engine, and fleet economics per day.

Produce EXACTLY this structure, concise and number-dense:
SITUATION: 2-3 sentences on fleet posture right now, citing the numbers.
TOP RISKS: ranked list (max 3). Each one line, citing the specific number or event that makes it a risk. Write "no acute risks" if none.
RECOMMENDED ACTIONS: max 4, each prefixed [auto-safe] (routine remediation: restarts, config resync, benchmark hygiene — these can ride the autopilot policy engine) or [needs-approval] (destructive or money-moving: kill, migrate, failover on live pods, subnet switches).
ANSWER: direct answer to the operator's question if one was asked; otherwise one line on what to watch next.

Rules: use ONLY the numbers provided — never invent metrics. Unknown/missing data is "unknown", not zero. Be blunt; no pleasantries. Under 300 words total.`;

export type CompletionFn = (messages: { role: string; content: string }[]) => Promise<string>;

async function defaultCompletion(messages: { role: string; content: string }[]): Promise<string> {
  const { default: ZAI } = await import("z-ai-web-dev-sdk");
  const zai = await ZAI.create();
  const completion = await zai.chat.completions.create({
    // Skill convention: the system prompt rides the "assistant" role.
    messages: messages.map((m, i) => ({
      role: i === 0 ? "assistant" : "user",
      content: m.content,
    })),
    thinking: { type: "disabled" },
  });
  const content = completion.choices[0]?.message?.content;
  if (!content || !content.trim()) throw new Error("Ops agent returned an empty response");
  return content;
}

export interface AgentNoteDTO {
  id: string;
  question: string | null;
  content: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

const NOTE_RETENTION = 50;

/** Run one agent analysis and persist it. Throws on SDK failure (caller 502s). */
export async function runOpsAgent(input: {
  question?: string;
  completion?: CompletionFn;
}): Promise<AgentNoteDTO> {
  const startedAt = Date.now();
  const ctx = await buildFleetContext();
  const userContent =
    (input.question?.trim() ? `OPERATOR QUESTION: ${input.question.trim()}\n\n` : "") +
    `FLEET DIGEST (JSON):\n${JSON.stringify(ctx)}`;

  const messages = [
    { role: "assistant", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
  const completion = input.completion ?? defaultCompletion;
  const content = await completion(messages);

  const row = await db.agentNote.create({
    data: {
      question: input.question?.trim() || null,
      content,
      metaJson: JSON.stringify({
        latencyMs: Date.now() - startedAt,
        miners: ctx.counts.monitored,
        openEvents: ctx.openEvents.length,
        openCritical: ctx.counts.openCritical,
        netPerDay: Math.round(ctx.economics.netPerDay * 100) / 100,
        contextChars: userContent.length,
      }),
    },
  });

  // Retention: keep the last 50 notes.
  try {
    const count = await db.agentNote.count();
    if (count > NOTE_RETENTION) {
      const old = await db.agentNote.findMany({
        orderBy: { createdAt: "desc" },
        skip: NOTE_RETENTION,
        select: { id: true },
      });
      if (old.length) await db.agentNote.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    }
  } catch {
    /* retention is best-effort */
  }

  return toNoteDTO(row);
}

export function toNoteDTO(row: {
  id: string;
  question: string | null;
  content: string;
  metaJson: string;
  createdAt: Date;
}): AgentNoteDTO {
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(row.metaJson) as Record<string, unknown>;
  } catch {
    meta = {};
  }
  return {
    id: row.id,
    question: row.question,
    content: row.content,
    meta,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listAgentNotes(limit = 10): Promise<AgentNoteDTO[]> {
  const rows = await db.agentNote.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  return rows.map(toNoteDTO);
}
