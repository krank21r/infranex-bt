import sshpk from "sshpk";
import crypto from "crypto";

/**
 * SSH key management for the Deployment Engine.
 *
 * Every real pod gets its OWN ephemeral ed25519 keypair: the public key is
 * injected into the pod at deploy time (RunPod `publicKey` input), the
 * private key is stored AES-256-GCM encrypted on the Deployment record.
 *
 * HOTKEY-ONLY POLICY: the platform NEVER puts wallet coldkeys, mnemonics or
 * private keys on remote machines. assertHotkeyOnly() is the hard gate.
 */

export interface SshKeypair {
  /** "ssh-ed25519 AAAA… comment" — inject into the pod. */
  publicKey: string;
  /** OpenSSH PEM private key — store encrypted, never log. */
  privateKey: string;
  fingerprint: string;
}

export function generateSshKeypair(comment = "infranex-bt"): SshKeypair {
  const key = sshpk.generatePrivateKey("ed25519");
  key.comment = `${comment}-${crypto.randomBytes(4).toString("hex")}`;
  return {
    publicKey: key.toPublic().toString("ssh"),
    privateKey: key.toString("openssh"),
    fingerprint: key.fingerprint("sha256").toString(),
  };
}

// ---------------------------------------------------------------------------
// Hotkey-only policy — the security gate for anything we send to a machine
// ---------------------------------------------------------------------------

/** Patterns that indicate private wallet material MUST NOT ship to a host. */
const FORBIDDEN_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bmnemonic\b|seed[_-]?phrase|recovery[_-]?phrase/i, label: "mnemonic/seed phrase" },
  { re: /\bcoldkey(mnemonic|seed)?\b/i, label: "coldkey material" },
  { re: /\bprivate[_-]?key\b/i, label: "private key" },
  { re: /\b0x[a-f0-9]{64,}\b/i, label: "hex private key" },
  { re: /\b(wif|xprv)\b/i, label: "WIF / extended private key" },
  { re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, label: "PEM private key" },
];

export interface PolicyViolation {
  label: string;
  where: string;
}

/**
 * Scan a deployment's env vars + command for private wallet material.
 * Returns [] when the config is hotkey-only (safe).
 */
export function assertHotkeyOnly(config: {
  docker: { command: string; envVars: { name: string; value: string }[] };
}): PolicyViolation[] {
  const violations: PolicyViolation[] = [];

  const scan = (where: string, text: string) => {
    for (const { re, label } of FORBIDDEN_PATTERNS) {
      if (re.test(text)) violations.push({ label, where });
    }
  };

  scan("docker.command", config.docker.command);
  for (const env of config.docker.envVars) {
    scan(`env.${env.name}`, `${env.name}=${env.value}`);
  }
  return violations;
}

export const HOTKEY_ONLY_POLICY_TEXT =
  "Hotkey-only policy: machines receive the PUBLIC hotkey (SS58) and network config only. " +
  "Coldkeys, mnemonics and wallet seeds never leave this machine's encrypted store.";
