import { NextRequest, NextResponse } from "next/server";
import { buildJudgeProfile, resolveSubnetName } from "@/lib/infranex/judge/service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/judge/sync { netuid } — (re)build a subnet's judge profile
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { netuid?: number };
    const netuid = Number(body.netuid);
    if (!Number.isInteger(netuid) || netuid < 0) {
      return NextResponse.json({ error: "netuid is required (non-negative integer)" }, { status: 400 });
    }
    const name = await resolveSubnetName(netuid);
    const profile = await buildJudgeProfile(netuid, name);
    return NextResponse.json({ ok: true, profile });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
