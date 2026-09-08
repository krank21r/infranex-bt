import { NextResponse } from "next/server";
import { fetchLiveSnapshot } from "@/lib/infranex/chain";

// Live network snapshot — chain + price. Polled by the client every 30s.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const snapshot = await fetchLiveSnapshot();
  return NextResponse.json(snapshot, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
