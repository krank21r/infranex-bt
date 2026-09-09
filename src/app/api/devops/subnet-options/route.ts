// Subnet options for the deploy picker: every live subnet with its name +
// GPU requirement (classifier / chain identity), so the DevOps console can
// list "which subnet do you want to deploy?" without heavy client merges.

import { NextResponse } from "next/server";
import { fetchLiveSnapshot } from "@/lib/infranex/chain";
import { classifySubnetHardware } from "@/lib/infranex/miner-score";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snap = await fetchLiveSnapshot();
    const rows = snap.subnets
      .filter((s) => s.netuid > 0)
      .map((s) => {
        const hw = classifySubnetHardware(s.name, s.identityDescription, {
          fallbackMonthlyUsd: s.minerEmissionTaoPerDay ?? undefined,
        });
        return {
          netuid: s.netuid,
          name: s.name || `Subnet ${s.netuid}`,
          gpuRequired: hw.recommendedGpu,
          minVramGb: hw.minVramGb,
          category: hw.category,
          minersCount: s.minersCount,
        };
      })
      .sort((a, b) => a.netuid - b.netuid);
    return NextResponse.json({ subnets: rows, source: snap.source });
  } catch (e) {
    return NextResponse.json(
      { subnets: [], error: e instanceof Error ? e.message : "unavailable" },
      { status: 200 }
    );
  }
}
