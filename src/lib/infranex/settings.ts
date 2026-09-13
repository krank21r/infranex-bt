import { db } from "@/lib/db";

// WALLET-ECON-1 — platform-level live-mining settings (singleton row id=1).
// One place for the chain network, the default wallet profile, the
// registration funding buffer, and the master-key backup acknowledgment.
// Every caller gets the row via getPlatformSettings() which lazily creates
// it — no migration seed needed.

export interface PlatformSettingsView {
  chainNetwork: string;
  defaultWalletProfileId: string | null;
  registrationBufferTao: number;
  masterKeyBackedUpAt: string | null;
}

export async function getPlatformSettings() {
  const existing = await db.platformSettings.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return db.platformSettings.create({ data: { id: 1 } });
}

export function serializeSettings(row: {
  chainNetwork: string;
  defaultWalletProfileId: string | null;
  registrationBufferTao: number;
  masterKeyBackedUpAt: Date | null;
}): PlatformSettingsView {
  return {
    chainNetwork: row.chainNetwork,
    defaultWalletProfileId: row.defaultWalletProfileId,
    registrationBufferTao: row.registrationBufferTao,
    masterKeyBackedUpAt: row.masterKeyBackedUpAt
      ? row.masterKeyBackedUpAt.toISOString()
      : null,
  };
}

export function isChainNetwork(v: unknown): v is "finney" | "test" {
  return v === "finney" || v === "test";
}
