// ---------------------------------------------------------------------------
// AUTH-1 — seed the 5-user base into AppUser + ensure a stable session
// signing secret.
//
// Credentials source: scripts/users.local.json (GITIGNORED — the GitHub repo
// is public; plaintext codes must never be committed):
//   [{ userId, label, role, code }, ...]
// If the file is missing, this script GENERATES 5 random users, writes the
// file, and prints the codes ONCE — copy them somewhere safe.
//
// Idempotent: existing users get their hash/label/role refreshed, active
// flag and lastLoginAt are preserved. Safe to re-run at any time
// (e.g. after an environment wipe: restore db OR just re-run this script).
//
// Run:  bun scripts/seed-users.ts
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const ROOT = path.resolve(path.dirname(process.argv[1] ?? process.cwd()), "..");
const USERS_FILE = path.join(ROOT, "scripts", "users.local.json");
const ENV_FILE = path.join(ROOT, ".env");

interface UserSeed {
  userId: string;
  label: string;
  role: string;
  code: string;
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L ambiguity
const group = () =>
  Array.from(crypto.randomBytes(4))
    .map((b) => ALPHABET[b % ALPHABET.length])
    .join("");
const makeCode = () => [group(), group(), group(), group()].join("-");

function loadUsers(): UserSeed[] {
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    const users = JSON.parse(raw) as UserSeed[];
    if (Array.isArray(users) && users.length > 0) return users;
    console.error("users.local.json is empty — regenerating.");
  } catch {
    console.error("users.local.json missing — generating 5 fresh users.");
  }
  const defaults: Array<[string, string, string]> = [
    ["admin", "Administrator", "admin"],
    ["ops01", "Operator One", "member"],
    ["ops02", "Operator Two", "member"],
    ["analyst01", "Analyst", "member"],
    ["viewer01", "Viewer", "member"],
  ];
  const users = defaults.map(([userId, label, role]) => ({
    userId,
    label,
    role,
    code: makeCode(),
  }));
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2) + "\n", { mode: 0o600 });
  console.log(`Wrote ${USERS_FILE} — SAVE THESE CODES NOW (shown once):\n`);
  for (const u of users) console.log(`  ${u.userId.padEnd(10)} ${u.code}`);
  console.log();
  return users;
}

/** scrypt hash — mirrors hashCode() in src/lib/auth-users.ts. */
function hashCode(code: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(code.normalize("NFKC"), salt, 64);
  return `s1:${salt.toString("hex")}:${hash.toString("hex")}`;
}

function ensureSessionSecret() {
  const current = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "";
  if (/^APP_SESSION_SECRET=.+/m.test(current.trim())) {
    console.log("APP_SESSION_SECRET already present in .env — keeping it.");
    return;
  }
  const secret = crypto.randomBytes(48).toString("hex");
  const line = `APP_SESSION_SECRET=${secret}\n`;
  fs.appendFileSync(ENV_FILE, current.endsWith("\n") || current === "" ? line : `\n${line}`);
  console.log("APP_SESSION_SECRET generated and appended to .env (48-hex).");
}

async function main() {
  const users = loadUsers();
  ensureSessionSecret();

  const db = new PrismaClient();
  try {
    for (const u of users) {
      if (!u.userId || !u.code) throw new Error(`Bad seed row: ${JSON.stringify(u)}`);
      await db.appUser.upsert({
        where: { userId: u.userId },
        create: {
          userId: u.userId,
          codeHash: hashCode(u.code),
          label: u.label,
          role: u.role,
        },
        update: {
          codeHash: hashCode(u.code), // refresh hash (re-run safe, code unchanged)
          label: u.label,
          role: u.role,
        },
      });
      console.log(`  seeded: ${u.userId} (${u.label}, ${u.role})`);
    }
    const total = await db.appUser.count();
    console.log(`\nAppUser rows: ${total}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
