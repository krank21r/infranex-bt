import { NextRequest, NextResponse } from "next/server";
import { getJudgeProfile, listJudgeProfiles } from "@/lib/infranex/judge/service";

export const dynamic = "force-dynamic";

// GET /api/judge/profiles — all persisted profiles
// GET /api/judge/profiles?netuid=8 — single profile (builds on first request)
export async function GET(req: NextRequest) {
  const netuidParam = req.nextUrl.searchParams.get("netuid");
  try {
    if (netuidParam !== null) {
      const netuid = Number(netuidParam);
      if (!Number.isInteger(netuid) || netuid < 0) {
        return NextResponse.json({ error: "netuid must be a non-negative integer" }, { status: 400 });
      }
      const profile = await getJudgeProfile(netuid);
      return NextResponse.json({ profile });
    }
    const profiles = await listJudgeProfiles();
    return NextResponse.json({ ok: true, profiles });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
