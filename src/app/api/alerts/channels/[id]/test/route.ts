import { NextRequest, NextResponse } from "next/server";
import { requireActiveAdmin } from "@/lib/auth-admin";
import { testChannel } from "@/lib/infranex/alerts";

export const dynamic = "force-dynamic";

/**
 * TIER4 — test-deliver a synthetic payload to one alert channel (ADMIN-ONLY).
 * Returns the delivery verdict so the UI can show "delivered" vs the error.
 * Gate = shared WINDUP-1 helper (role + still-active revocation check).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireActiveAdmin(req);
  if ("error" in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { id } = await params;
  try {
    const r = await testChannel(id);
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Test send failed" },
      { status: 400 }
    );
  }
}
