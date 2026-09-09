// Subnet Requirements Profiler API — GET ?netuid=N
// Returns what the subnet needs (GPU, OS packages, python, pip deps, repo,
// entrypoint, miner command) pulled from chain + GitHub. Cached 6h in DB.

import { NextResponse } from "next/server";
import { pullSubnetRequirements } from "@/lib/devops/subnet-requirements";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const netuid = parseInt(url.searchParams.get("netuid") ?? "", 10);
  const refresh = url.searchParams.get("refresh") === "1";
  if (!Number.isFinite(netuid) || netuid < 0 || netuid > 1024)
    return NextResponse.json({ error: "netuid must be 0-1024" }, { status: 400 });

  try {
    const { profile, cached } = await pullSubnetRequirements(netuid, { refresh });
    return NextResponse.json({ profile, cached });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "profiler failed" },
      { status: 500 }
    );
  }
}
