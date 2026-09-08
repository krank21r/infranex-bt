import { NextResponse } from "next/server";
import { fetchLiveGpuOffers } from "@/lib/infranex/runpod";

// Live GPU offers from RunPod's GraphQL API. Polled every 60s by the client.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const snapshot = await fetchLiveGpuOffers();
  return NextResponse.json(snapshot, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
