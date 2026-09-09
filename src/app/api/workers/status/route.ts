import { NextResponse } from "next/server";
import { getWorkerStatuses, getLatestChainSnapshot } from "@/lib/infranex/workers";

export const dynamic = "force-dynamic";

// GET /api/workers/status — get the status of all background workers
export async function GET() {
  const [statuses, latestSnapshot] = await Promise.all([
    getWorkerStatuses(),
    getLatestChainSnapshot(),
  ]);
  return NextResponse.json({
    workers: statuses,
    latestSnapshot: latestSnapshot
      ? {
          blockNumber: latestSnapshot.blockNumber,
          totalSubnets: latestSnapshot.totalSubnets,
          scannedSubnets: latestSnapshot.subnets.length,
          neuronCount: latestSnapshot.neurons.length,
          taoPriceUsd: latestSnapshot.taoPriceUsd,
          fetchedAt: latestSnapshot.fetchedAt,
          source: latestSnapshot.source,
        }
      : null,
  });
}
