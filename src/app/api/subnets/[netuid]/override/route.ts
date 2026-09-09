import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/subnets/[netuid]/override — get the user override for a subnet
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ netuid: string }> }
) {
  const { netuid } = await params;
  const n = parseInt(netuid, 10);
  const override = await db.subnetOverride.findUnique({ where: { netuid: n } });
  return NextResponse.json({ override });
}

// PUT /api/subnets/[netuid]/override — create or update the override
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ netuid: string }> }
) {
  const { netuid } = await params;
  const n = parseInt(netuid, 10);
  const body = await req.json();

  const data = {
    name: body.name ?? null,
    description: body.description ?? null,
    category: body.category ?? null,
    minVramGb: body.minVramGb ? parseInt(body.minVramGb, 10) : null,
    recommendedGpu: body.recommendedGpu ?? null,
    githubUrl: body.githubUrl ?? null,
    website: body.website ?? null,
    tags: body.tags ? JSON.stringify(body.tags) : null,
  };

  const override = await db.subnetOverride.upsert({
    where: { netuid: n },
    create: { netuid: n, ...data },
    update: data,
  });

  return NextResponse.json({ override });
}

// DELETE /api/subnets/[netuid]/override — remove the override (revert to curated)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ netuid: string }> }
) {
  const { netuid } = await params;
  const n = parseInt(netuid, 10);
  await db.subnetOverride.delete({ where: { netuid: n } }).catch(() => {});
  return NextResponse.json({ success: true });
}
