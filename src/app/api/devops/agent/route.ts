import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth-admin";
import { listAgentNotes, runOpsAgent } from "@/lib/infranex/ops-agent";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * TIER4 — AI Ops Agent.
 *
 *   GET            → the 10 most recent persisted analyses
 *   POST {question?} → run one analysis over the live fleet digest and
 *                      persist it. LLM failures surface as 502 with the
 *                      message — the engine itself is untouched.
 *
 * The proxy gates the session; any signed-in operator may consult the agent.
 * WINDUP-1: POST additionally (a) re-checks the account is still active and
 * (b) throttles per operator — 15s between runs and 40 runs / rolling day
 * (counted on SUCCESS only, so a down SDK never locks anyone out) — so a
 * runaway client loop cannot burn unbounded LLM spend.
 */

const MIN_INTERVAL_MS = 15_000;
const DAILY_CAP = 40;

const runs = new Map<string, { lastAt: number; day: string; count: number }>();

function throttleCheck(uid: string): string | null {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const rec = runs.get(uid);
  if (!rec || rec.day !== today) {
    return null; // fresh day — caller records the new bucket
  }
  if (now - rec.lastAt < MIN_INTERVAL_MS) {
    const waitS = Math.ceil((MIN_INTERVAL_MS - (now - rec.lastAt)) / 1000);
    return `Rate limit — one analysis per minute. Try again in ${waitS}s.`;
  }
  if (rec.count >= DAILY_CAP) {
    return `Daily cap reached (${DAILY_CAP} analyses/day). Try again tomorrow.`;
  }
  return null;
}

function throttleRecord(uid: string) {
  const today = new Date().toISOString().slice(0, 10);
  const rec = runs.get(uid);
  if (!rec || rec.day !== today) {
    runs.set(uid, { lastAt: Date.now(), day: today, count: 1 });
  } else {
    rec.lastAt = Date.now();
    rec.count += 1;
  }
}

export async function GET() {
  try {
    const notes = await listAgentNotes(10);
    return NextResponse.json({ ok: true, notes });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to list agent notes" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireActiveUser(req);
  if ("error" in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const uid = gate.session.uid;

  const throttled = throttleCheck(uid);
  if (throttled) {
    return NextResponse.json({ error: throttled }, { status: 429 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { question?: unknown };
    const question = typeof body.question === "string" ? body.question.slice(0, 500) : undefined;
    const note = await runOpsAgent({ question });
    throttleRecord(uid); // success only — failures cost nothing and must not eat the cap
    return NextResponse.json({ ok: true, note });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ops agent run failed" },
      { status: 502 }
    );
  }
}
