import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/subnet-overrides — list all user overrides
export async function GET() {
  const overrides = await db.subnetOverride.findMany();
  return NextResponse.json({ overrides });
}
