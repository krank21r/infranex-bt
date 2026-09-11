import { NextRequest, NextResponse } from "next/server";
import { listJudgeRuns } from "@/lib/infranex/judge/service";

export const dynamic = "force-dynamic";

// GET /api/judge/runs?limit=20 — recent mock-validator runs
export async function GET(req: NextRequest) {
  try {
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? 20);
    const runs = await listJudgeRuns(
      Number.isFinite(limit) ? Math.min(Math.max(1, limit), 100) : 20
    );
    return NextResponse.json({ ok: true, runs });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
