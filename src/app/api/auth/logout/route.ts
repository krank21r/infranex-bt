// POST /api/auth/logout — clear the session cookie (AUTH-1).

import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  // maxAge 0 → the browser drops the cookie immediately.
  res.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
  return res;
}
