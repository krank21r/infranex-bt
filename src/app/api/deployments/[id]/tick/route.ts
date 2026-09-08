import { NextResponse } from "next/server";
import { advanceDeployment } from "@/lib/infranex/deployment/engine";

export const dynamic = "force-dynamic";

// POST /api/deployments/[id]/tick — advance the deployment one step
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const deployment = await advanceDeployment(id);
    return NextResponse.json({ deployment });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
