// ---------------------------------------------------------------------------
// AUTH-1 — user base for the gated login (server-only, Node runtime).
//
// Login is ID + access code ONLY (no email/password reset flows). Codes are
// stored TWO ways:
//   codeHash — one-way scrypt ("s1:<saltHex>:<hashHex>"), used to verify.
//   codeEnc  — AES-256-GCM (devops secret), lets the ADMIN PANEL display the
//              current codes without any chat transcription.
// Plaintext mirror files (kept in sync on every change):
//   scripts/users.local.json                (gitignored — repo is public)
//   /tmp/my-project/infranex-users.local.json (survives container wipes)
// ---------------------------------------------------------------------------
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/devops/crypto";

export interface AppUserRow {
  userId: string;
  label: string | null;
  role: string;
}

const SCRYPT_KEYLEN = 64;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L ambiguity

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

// ---------------------------------------------------------------------------
// Admin panel helpers (ADMINPANEL-1) — all callers MUST have verified the
// session role is "admin" first.
// ---------------------------------------------------------------------------

/** Human-typeable code: XXXX-XXXX-XXXX-XXXX from a no-ambiguity alphabet. */
export function generateAccessCode(): string {
  const group = () =>
    Array.from(crypto.randomBytes(4))
      .map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
      .join("");
  return [group(), group(), group(), group()].join("-");
}

/** Persist a user's code (hash + encrypted form) in one write. */
async function storeCode(userId: string, code: string) {
  await db.appUser.update({
    where: { userId },
    data: { codeHash: hashCode(code), codeEnc: encryptSecret(code) },
  });
}

/** Mirror every user's current plaintext code to the two local files. */
export async function syncCredentialFiles(): Promise<{ main: string; backup: string | null }> {
  const rows = await db.appUser.findMany({ orderBy: { userId: "asc" } });
  const payload = rows.map((r) => ({
    userId: r.userId,
    label: r.label ?? r.userId,
    role: r.role,
    code: r.codeEnc ? decryptSecret(r.codeEnc) : "",
  }));
  const json = JSON.stringify(payload, null, 2) + "\n";

  const mainPath = path.join(process.cwd(), "scripts", "users.local.json");
  fs.mkdirSync(path.dirname(mainPath), { recursive: true });
  fs.writeFileSync(mainPath, json, { mode: 0o600 });

  // Best-effort wipe-proof copy — the /tmp auto-backup survived every reset.
  let backupPath: string | null = null;
  try {
    backupPath = "/tmp/my-project/infranex-users.local.json";
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, json, { mode: 0o600 });
  } catch {
    backupPath = null; // non-fatal — the main mirror still exists
  }
  return { main: mainPath, backup: backupPath };
}

/** Admin list: everything the panel shows, including decrypted codes. */
export async function listUsersWithCodes() {
  const rows = await db.appUser.findMany({ orderBy: { userId: "asc" } });
  return rows.map((r) => ({
    userId: r.userId,
    label: r.label ?? r.userId,
    role: r.role,
    active: r.active,
    code: r.codeEnc ? decryptSecret(r.codeEnc) : null, // null → regenerate to restore
    lastLoginAt: r.lastLoginAt ? r.lastLoginAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Admin action: replace a user's code with a fresh random one. */
export async function regenerateUserCode(userId: string): Promise<string> {
  const row = await db.appUser.findUnique({ where: { userId } });
  if (!row) throw new Error("User not found");
  const code = generateAccessCode();
  await storeCode(userId, code);
  await syncCredentialFiles();
  return code;
}

/** Admin action: enable/disable a login without deleting the account. */
export async function setUserActive(userId: string, active: boolean) {
  await db.appUser.update({ where: { userId }, data: { active } });
  await syncCredentialFiles().catch(() => undefined);
  return { userId, active };
}
