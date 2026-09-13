import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { testChannel } from "@/lib/infranex/alerts";

export const dynamic = "force-dynamic";

/**
 * TIER4 — test-deliver a synthetic payload to one alert channel (ADMIN-ONLY).
 * Returns the delivery verdict so the UI can show "delivered" vs the error.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Admin privileges required." }, { status: 403 });
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
