import { NextRequest, NextResponse } from "next/server";
import {
  createDeployment,
  listDeployments,
} from "@/lib/infranex/deployment/engine";
import { subnets, gpuOffers } from "@/lib/infranex/data";

export const dynamic = "force-dynamic";

// GET /api/deployments — list all deployments
export async function GET() {
  const deployments = await listDeployments();
  return NextResponse.json({ deployments });
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
      mode: "mock" | "runpod";
    };

    const subnet = subnets.find((s) => s.netuid === netuid);
    if (!subnet) return NextResponse.json({ error: "Subnet not found" }, { status: 400 });

    const offer = gpuOffers.find((o) => o.id === offerId);
    if (!offer) return NextResponse.json({ error: "GPU offer not found" }, { status: 400 });

    if (!minerName?.trim()) {
      return NextResponse.json({ error: "minerName is required" }, { status: 400 });
    }

    const deployment = await createDeployment({
      subnet,
      offer,
      minerName: minerName.trim(),
      hotkey: hotkey?.trim() || undefined,
      walletName: walletName?.trim() || undefined,
      mode: mode ?? "mock",
    });

    return NextResponse.json({ deployment }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
