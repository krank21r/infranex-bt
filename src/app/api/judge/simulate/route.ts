import { NextRequest, NextResponse } from "next/server";
import { runSimulation } from "@/lib/infranex/judge/service";
import type { MinerSpec } from "@/lib/infranex/judge/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function isMinerSpec(s: unknown): s is MinerSpec {
  const v = s as MinerSpec;
  return (
    typeof v === "object" && v !== null &&
    Number.isFinite(v.latencyMs) && v.latencyMs > 0 &&
    Number.isFinite(v.uptimePct) && v.uptimePct >= 0 && v.uptimePct <= 100 &&
    Number.isFinite(v.qualityPct) && v.qualityPct >= 0 && v.qualityPct <= 100 &&
    Number.isFinite(v.throughputTps) && v.throughputTps >= 0 &&
    Number.isFinite(v.pricePerMTokUsd) && v.pricePerMTokUsd >= 0
  );
}

// POST /api/judge/simulate { netuid, spec } — mock-validator run
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { netuid?: number; spec?: unknown };
    const netuid = Number(body.netuid);
    if (!Number.isInteger(netuid) || netuid < 0) {
      return NextResponse.json({ error: "netuid is required (non-negative integer)" }, { status: 400 });
    }
    if (!isMinerSpec(body.spec)) {
      return NextResponse.json(
        {
          error:
            "spec must be { latencyMs: number>0, uptimePct: 0-100, qualityPct: 0-100, throughputTps: number>=0, pricePerMTokUsd: number>=0 }",
        },
        { status: 400 }
      );
    }
    const { profile, result } = await runSimulation(netuid, body.spec);
    return NextResponse.json({ ok: true, profile, result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
