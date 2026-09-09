import { NextResponse } from "next/server";
import { fetchLiveSnapshot } from "@/lib/infranex/chain";
import { startWorkers } from "@/lib/infranex/workers";

// Live network snapshot — chain + price. Polled by the client every 30s.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Auto-start background workers on first API call
let workersInitialized = false;
if (!workersInitialized) {
  workersInitialized = true;
  // Start workers in the background (non-blocking)
  void startWorkers();
}

export async function GET() {
  const snapshot = await fetchLiveSnapshot();
  return NextResponse.json(snapshot, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
