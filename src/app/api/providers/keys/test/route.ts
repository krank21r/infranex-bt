import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/devops/crypto";
import {
  PROVIDER_META,
  isProviderId,
  validateProviderKey,
  invalidateProvidersCache,
} from "@/lib/infranex/providers";

// POST /api/providers/keys/test — re-validate a provider API key on demand
// (the GPU catalog dialog's "Test" button).
//
// Body: { provider, key? }
//   - { provider }          → test the STORED key (and refresh its status row)
//   - { provider, key }     → probe a candidate key WITHOUT saving it
//
// Responses: { check } on 200; 404 when the provider has no public API to
// test (nvidia) or nothing is stored; 400 on bad input. Plaintext keys are
// never echoed back.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { provider?: string; key?: string }
    | null;
  const provider = body?.provider;
  const candidate = typeof body?.key === "string" ? body.key.trim() : "";

  if (!isProviderId(provider)) {
    return NextResponse.json({ error: "Unknown provider." }, { status: 400 });
  }
  const meta = PROVIDER_META.find((p) => p.id === provider)!;
  if (!meta.offers && !meta.rent) {
    return NextResponse.json(
      { error: `${meta.label} has no public API to connect yet.` },
      { status: 404 }
    );
  }

  // Resolve the key to test: explicit candidate wins, else the stored one.
  let key = candidate;
  let stored = false;
  if (!key) {
    const row = await db.providerKey.findUnique({ where: { provider } });
    if (!row) {
      return NextResponse.json(
        { error: `No key stored for ${meta.label} — add one first.` },
        { status: 404 }
      );
    }
    key = decryptSecret(row.keyEnc);
    stored = true;
  }
  if (!key) {
    return NextResponse.json(
      { error: `Stored key for ${meta.label} could not be read — re-enter it.` },
      { status: 404 }
    );
  }
  if (key.length < 8) {
    return NextResponse.json({ error: "That API key looks too short." }, { status: 400 });
  }
  if (/\s/.test(key)) {
    return NextResponse.json({ error: "API keys must not contain whitespace." }, { status: 400 });
  }

  const check = await validateProviderKey(provider, key);

  // A stored-key test refreshes the persisted verdict so the catalog UI and
  // GET /keys stay in sync. Candidate probes never touch the database.
  if (stored) {
    await db.providerKey.update({
      where: { provider },
      data: { status: check.status, statusMessage: check.message, lastCheckedAt: new Date() },
    }).catch(() => undefined);
    invalidateProvidersCache();
  }

  return NextResponse.json({ check });
}
