// ---------------------------------------------------------------------------
// DevOps Engine — credential encryption at rest.
//
// SSH passwords / private keys are stored AES-256-GCM encrypted. The key
// comes from DEVOPS_SECRET (32+ chars recommended); if absent, a strong key
// is generated once and persisted to .devops-secret (gitignored) so secrets
// survive restarts without manual setup.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SECRET_FILE = path.join(process.cwd(), ".devops-secret");

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.DEVOPS_SECRET;
  if (fromEnv && fromEnv.length >= 16) {
    cachedKey = crypto.createHash("sha256").update(fromEnv).digest();
    return cachedKey;
  }
  try {
    const existing = fs.readFileSync(SECRET_FILE, "utf8").trim();
    if (existing.length >= 32) {
      cachedKey = crypto.createHash("sha256").update(existing).digest();
      return cachedKey;
    }
  } catch {
    /* first run — create below */
  }
  const generated = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
  cachedKey = crypto.createHash("sha256").update(generated).digest();
  return cachedKey;
}

/** Encrypt a secret → "iv:tag:ciphertext" (all hex). */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

/** Decrypt "iv:tag:ciphertext" → plaintext ("" on tamper). */
export function decryptSecret(payload: string): string {
  try {
    const [ivHex, tagHex, dataHex] = payload.split(":");
    if (!ivHex || !tagHex || !dataHex) return "";
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      getKey(),
      Buffer.from(ivHex, "hex")
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}

/** Never echo secrets back to the UI — show only a shape hint. */
export function secretHint(plain: string): string {
  if (!plain) return "";
  if (plain.startsWith("-----BEGIN")) return `key(${plain.length} chars)`;
  return `****${plain.slice(-2)}`;
}
