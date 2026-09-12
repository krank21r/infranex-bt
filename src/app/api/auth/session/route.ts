// GET /api/auth/session — who is signed in? (AUTH-1)
// Used by the header user chip. 401 when there is no valid session.

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  return NextResponse.json({
    user: {
      userId: session.uid,
      label: session.label ?? session.uid,
      role: session.role ?? "member",
    },
    expiresAt: session.exp * 1000,
  });
}
