// ---------------------------------------------------------------------------
// AUTH-1 — session tokens for the gated login (ID + access code).
//
// ISOMORPHIC by design: uses ONLY Web Crypto (crypto.subtle) so the same
// verify code runs in the proxy (Edge runtime) and in API routes (Node).
// Token format:  v1.<base64url payload>.<base64url HMAC-SHA256>
// Payload:       { uid, label, role, exp }  (seconds epoch)
//
// The signing secret comes from APP_SESSION_SECRET (.env, gitignored).
// If it is missing, a per-boot random secret is used — sessions simply do
// not survive a restart until the seed script writes a stable secret.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";

export const SESSION_COOKIE = "infranex_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SessionPayload {
  uid: string;
  label?: string;
  role?: string;
  exp: number; // epoch seconds
}

let bootSecret: string | null = null;

/** Signing secret: stable from env, else random per boot (degraded mode). */
export function getSessionSecret(): string {
  const fromEnv = process.env.APP_SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  if (!bootSecret) {
    bootSecret = crypto.randomBytes(48).toString("hex");
    console.warn(
      "[auth] APP_SESSION_SECRET missing — using a per-boot secret (sessions reset on restart). Run scripts/seed-users.ts to persist one."
    );
  }
  return bootSecret;
}

// --- base64url helpers (Buffer-based — works in Node & Edge) ----------------

function b64urlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function b64urlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Buffer.from(sig).toString("base64url");
}

/** Constant-time string compare (avoids trivial timing oracles). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length || ab.length === 0) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Create a signed session token for a user. */
export async function createSessionToken(user: {
  userId: string;
  label?: string | null;
  role?: string | null;
}): Promise<string> {
  const payload: SessionPayload = {
    uid: user.userId,
    label: user.label ?? undefined,
    role: user.role ?? undefined,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = await hmac(body);
  return `v1.${body}.${sig}`;
}

/** Verify a token → payload, or null when invalid/expired/tampered. */
export async function verifySessionToken(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [, body, sig] = parts;
  const expected = await hmac(body);
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body)) as SessionPayload;
    if (!payload?.uid || typeof payload.exp !== "number") return null;
    if (payload.exp * 1000 < Date.now()) return null; // expired
    return payload;
  } catch {
    return null;
  }
}

/** Cookie attributes for the session (httpOnly, 30d, SameSite=Lax). */
export function sessionCookieOptions(maxAge: number = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false, // served over the platform's http proxy; do not drop the cookie
    path: "/",
    maxAge,
  };
}
