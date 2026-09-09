import { NextRequest, NextResponse } from "next/server";
import { startWorkers } from "@/lib/infranex/workers";

export const dynamic = "force-dynamic";

// POST /api/workers/trigger — start the background workers (if not already running)
export async function POST(_req: NextRequest) {
  startWorkers();
  return NextResponse.json({
    started: true,
    message: "Background workers started (chain scanner every 2min, market data every 1min, GitHub analyzer every 60min)",
  });
}
