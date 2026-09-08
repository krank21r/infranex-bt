import { NextResponse } from "next/server";
import { fetchMonitoringOverview } from "@/lib/infranex/monitoring";
import { computeOptimizations } from "@/lib/infranex/optimization";

// Live monitoring + optimization overview — per-deployment pod status,
// on-chain metrics, rewards, cost/ROI, alerts, and Keep/Optimize/Switch
// recommendations. Polled every 30s.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function GET() {
  const overview = await fetchMonitoringOverview();
  const optimizations = computeOptimizations(overview);
  return NextResponse.json(
    { ...overview, optimizations },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
