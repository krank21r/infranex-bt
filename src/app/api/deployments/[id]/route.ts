import { NextResponse } from "next/server";
import { getDeployment, deleteDeployment } from "@/lib/infranex/deployment/engine";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const deployment = await getDeployment(id);
  if (!deployment) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ deployment });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await deleteDeployment(id);
  return NextResponse.json({ success: true });
}
