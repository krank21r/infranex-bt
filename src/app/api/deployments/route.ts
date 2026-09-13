import { NextRequest, NextResponse } from "next/server";
import {
  createDeployment,
  listDeployments,
} from "@/lib/infranex/deployment/engine";
import { subnets, gpuOffers } from "@/lib/infranex/data";
import { fetchLiveSnapshot } from "@/lib/infranex/chain";
import { pullSubnetRequirements } from "@/lib/devops/subnet-requirements";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import type { Subnet } from "@/lib/infranex/types";

export const dynamic = "force-dynamic";

// GET /api/deployments — list deployments.
// TIER4 light tenancy: ?scope=mine restricts the list to the caller's own
// deployments (ownerUserId). Default (no scope) returns everything — the
// team-shared model: pre-tenancy rows have no owner and stay visible to all.
export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get("scope");
  if (scope === "mine") {
    const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
    if (session?.uid) {
      const deployments = await listDeployments({ ownerUserId: session.uid });
      return NextResponse.json({ deployments });
    }
  }
  const deployments = await listDeployments();
  return NextResponse.json({ deployments });
}

// The curated catalog first; any OTHER live subnet (chain snapshot) is built
// on demand — min VRAM + GPU come from the cached requirements profile so the
// installer's compat gate stays accurate. This is what lets the wizard deploy
// to ALL ~120 live subnets, not just the 16 curated ones.
async function resolveSubnet(netuid: number): Promise<Subnet | null> {
  const curated = subnets.find((s) => s.netuid === netuid);
  if (curated) return curated;

  try {
    const snap = await fetchLiveSnapshot();
    const m = snap.subnets.find((s) => s.netuid === netuid);
    if (!m) return null;

    let minVramGb = 24;
    let recommendedGpu = "H100";
    try {
      const { profile } = await pullSubnetRequirements(netuid);
      if (profile.minVramGb > 0) minVramGb = profile.minVramGb;
      if (profile.recommendedGpu) recommendedGpu = profile.recommendedGpu;
    } catch {
      // profiler unavailable — generic fallbacks above
    }

    const name = m.name ?? `Subnet ${netuid}`;
    return {
      netuid,
      name,
      symbol: name.replace(/[^A-Za-z0-9]/g, "").slice(0, 5).toUpperCase() || `S${netuid}`,
      description: m.identityDescription ?? "",
      category: "Live",
      owner: m.owner ?? "",
      tempo: 360,
      emission: 0,
      taoInReserve: m.subnetTao ?? 0,
      price: 0,
      marketCap: 0,
      volume24h: 0,
      change24h: 0,
      minersCount: m.minersCount,
      validatorsCount: m.validatorsCount ?? 0,
      maxNeurons: m.maxUids ?? 256,
      status: "active",
      registrationOpen: true,
      createdAt: m.registeredAt ? String(m.registeredAt) : new Date().toISOString(),
      tags: [],
      minVramGb,
      recommendedGpu,
      burnCostTao: m.burnCostTao ?? null,
      immunityBlocks: m.immunityBlocks ?? null,
      maxUids: m.maxUids ?? null,
      rewardedMiners: m.rewardedMiners ?? null,
    } as Subnet;
  } catch {
    return null;
  }
}

// POST /api/deployments — create a new deployment
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { netuid, offerId, minerName, hotkey, walletName, mode } = body as {
      netuid: number;
      offerId: string;
      minerName: string;
      hotkey?: string;
      walletName?: string;
      mode: "mock" | "runpod" | "vast";
    };

    if (mode !== "mock" && mode !== "runpod" && mode !== "vast") {
      return NextResponse.json({ error: "mode must be mock, runpod, or vast" }, { status: 400 });
    }

    const subnet = await resolveSubnet(netuid);
    if (!subnet) return NextResponse.json({ error: "Subnet not found" }, { status: 400 });

    const offer = gpuOffers.find((o) => o.id === offerId);
    if (!offer) return NextResponse.json({ error: "GPU offer not found" }, { status: 400 });

    if (!minerName?.trim()) {
      return NextResponse.json({ error: "minerName is required" }, { status: 400 });
    }

    // TIER4 — attribute the deployment to its creator (light tenancy).
    const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
    const deployment = await createDeployment({
      subnet,
      offer,
      minerName: minerName.trim(),
      hotkey: hotkey?.trim() || undefined,
      walletName: walletName?.trim() || undefined,
      mode: mode ?? "mock",
      owner: session?.uid
        ? { userId: session.uid, label: session.label ?? undefined }
        : undefined,
    });

    return NextResponse.json({ deployment }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
