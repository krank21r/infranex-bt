// POST /api/auth/login — ID + access code → session cookie (AUTH-1).
//
// Rate limiting: in-memory, 10 failed attempts per IP per 5 minutes, reset
// on success. Good enough for a 5-operator gate; brute force is throttled
// without external state.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyLogin } from "@/lib/auth-users";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

const WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILURES = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local"
  );
}

function tooManyAttempts(ip: string): number {
  const rec = attempts.get(ip);
  if (!rec) return 0;
  if (Date.now() > rec.resetAt) {
    attempts.delete(ip);
    return 0;
  }
  return rec.count;
}

function recordFailure(ip: string) {
  const rec = attempts.get(ip);
  if (rec && Date.now() <= rec.resetAt) {
    rec.count += 1;
  } else {
    attempts.set(ip, { count: 1, resetAt: Date.now() + WINDOW_MS });
  }
}

export async function POST(req: NextRequest) {
  let body: { userId?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const userId = (body.userId ?? "").trim();
  const code = (body.code ?? "").trim();
  if (!userId || !code) {
    return NextResponse.json(
      { error: "User ID and access code are both required." },
      { status: 400 }
    );
  }

  const ip = clientIp(req);
  if (tooManyAttempts(ip) >= MAX_FAILURES) {
    return NextResponse.json(
      { error: "Too many failed attempts — wait 5 minutes and try again." },
      { status: 429 }
    );
  }

  const user = await verifyLogin(userId, code);
  if (!user) {
    recordFailure(ip);
    // Uniform message — do not reveal whether the ID exists.
    return NextResponse.json(
      { error: "Invalid user ID or access code." },
      { status: 401 }
    );
  }

  attempts.delete(ip);
  await db.appUser.update({
    where: { userId: user.userId },
    data: { lastLoginAt: new Date() },
  }).catch(() => undefined); // never block a valid login on bookkeeping

  const token = await createSessionToken(user);
  const res = NextResponse.json({
    ok: true,
    user: { userId: user.userId, label: user.label, role: user.role },
  });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
