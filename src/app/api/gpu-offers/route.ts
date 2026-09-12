import { NextResponse } from "next/server";
import { fetchAllLiveOffers } from "@/lib/infranex/providers";

// Live GPU offers from every configured provider (RunPod, Vast.ai, Lambda —
// keys managed in the GPU catalog). Providers without a stored key are listed
// as not configured; curated/indicative data is merged client-side.
// Polled every 60s by the client.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const snapshot = await fetchAllLiveOffers();
  return NextResponse.json(snapshot, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
