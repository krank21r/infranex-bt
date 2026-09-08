import { NextResponse } from "next/server";
import { fetchMonitoringOverview } from "@/lib/infranex/monitoring";

// Live monitoring overview — per-deployment pod status, on-chain metrics,
// rewards, cost/ROI, alerts. Polled every 30s.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function GET() {
  const overview = await fetchMonitoringOverview();
  return NextResponse.json(overview, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
