// ---------------------------------------------------------------------------
// AUTH-1 — user base for the gated login (server-only, Node runtime).
//
// Login is ID + access code ONLY (no email/password reset flows). Codes are
// stored ONE-WAY hashed:  scrypt(salt, code) → "s1:<saltHex>:<hashHex>".
// The 5 seeded users live in scripts/users.local.json (gitignored — the
// GitHub repo is public); seed-users.ts upserts them into AppUser.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import { db } from "@/lib/db";

export interface AppUserRow {
  userId: string;
  label: string | null;
  role: string;
}

const SCRYPT_KEYLEN = 64;

/** Hash a code → "s1:<saltHex>:<hashHex>" (scrypt N=16384, p=1). */
export function hashCode(code: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(code.normalize("NFKC"), salt, SCRYPT_KEYLEN);
  return `s1:${salt.toString("hex")}:${hash.toString("hex")}`;
}

/** Constant-time verification of a candidate code against a stored hash. */
export function verifyCode(code: string, stored: string): boolean {
  try {
    const [version, saltHex, hashHex] = stored.split(":");
    if (version !== "s1" || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const candidate = crypto.scryptSync(code.normalize("NFKC"), salt, expected.length);
    return crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

/**
 * Verify a login attempt. Returns the user row on success, null on failure.
 * Inactive accounts are rejected. lastLoginAt is NOT touched here (the login
 * route does it once the cookie is minted).
 */
export async function verifyLogin(userId: string, code: string): Promise<AppUserRow | null> {
  if (!userId || !code) return null;
  const row = await db.appUser.findUnique({ where: { userId } });
  if (!row || !row.active) return null;
  if (!verifyCode(code, row.codeHash)) return null;
  return { userId: row.userId, label: row.label, role: row.role };
}
