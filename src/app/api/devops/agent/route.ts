import { NextRequest, NextResponse } from "next/server";
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
 */

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
  try {
    const body = (await req.json().catch(() => ({}))) as { question?: unknown };
    const question = typeof body.question === "string" ? body.question.slice(0, 500) : undefined;
    const note = await runOpsAgent({ question });
    return NextResponse.json({ ok: true, note });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ops agent run failed" },
      { status: 502 }
    );
  }
}
