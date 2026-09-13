import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireActiveAdmin } from "@/lib/auth-admin";
import { decryptSecret, encryptSecret } from "@/lib/devops/crypto";
import {
  PROVIDER_META,
  isProviderId,
  maskKey,
  validateProviderKey,
  invalidateProvidersCache,
  type ProviderId,
} from "@/lib/infranex/providers";
import { logAudit } from "@/lib/infranex/audit";

// Provider API keys — manage from the GPU catalog. The plaintext key NEVER
// leaves the server: GET returns a masked hint only, PUT encrypts at rest and
// immediately validates against the provider so the UI shows a verdict.
//
// WINDUP-1: GET stays session-gated (masked hints only, needed by the wizard
// to know whether real rental is configured); PUT/DELETE are ADMIN-ONLY and
// re-check the account is still active — these routes decide which credential
// the platform spends with, so members (viewer/analyst/ops) must never be
// able to swap or delete rental keys.

export const dynamic = "force-dynamic";

function labelOf(provider: string): string {
  return PROVIDER_META.find((p) => p.id === provider)?.label ?? provider;
}

function serialize(row: {
  provider: string;
  keyEnc: string;
  status: string;
  statusMessage: string | null;
  lastCheckedAt: Date | null;
}) {
  const plain = decryptSecret(row.keyEnc);
  return {
    provider: row.provider,
    label: labelOf(row.provider),
    maskedKey: plain ? maskKey(plain) : null,
    status: row.status,
    statusMessage: row.statusMessage,
    lastCheckedAt: row.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
  };
}

/** List every provider with its key-management state (never the key itself). */
export async function GET() {
  const rows = await db.providerKey.findMany();
  const keys = PROVIDER_META.map((meta) => {
    const row = rows.find((r) => r.provider === meta.id);
    return {
      id: meta.id,
      offers: meta.offers,
      rent: meta.rent,
      keyHint: meta.keyHint,
      note: meta.note ?? null,
      hasKey: Boolean(row),
      ...(row
        ? serialize(row)
        : { label: meta.label, maskedKey: null, status: null, statusMessage: null, lastCheckedAt: null }),
    };
  });
  return NextResponse.json({ keys });
}

/** Add or update a provider key. Encrypts, saves, and validates immediately. */
export async function PUT(req: NextRequest) {
  const gate = await requireActiveAdmin(req);
  if ("error" in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const body = (await req.json().catch(() => null)) as { provider?: string; key?: string } | null;
  const provider = body?.provider;
  const key = typeof body?.key === "string" ? body.key.trim() : "";

  if (!isProviderId(provider)) {
    return NextResponse.json({ error: "Unknown provider." }, { status: 400 });
  }
  const meta = PROVIDER_META.find((p) => p.id === provider)!;
  if (!meta.offers && !meta.rent) {
    return NextResponse.json(
      { error: `${meta.label} has no public API to connect yet.` },
      { status: 400 }
    );
  }
  if (key.length < 8) {
    return NextResponse.json({ error: "That API key looks too short." }, { status: 400 });
  }
  if (/\s/.test(key)) {
    return NextResponse.json({ error: "API keys must not contain whitespace." }, { status: 400 });
  }

  const check = await validateProviderKey(provider, key);
  const rowsBefore = await db.providerKey.findUnique({ where: { provider } });
  const now = new Date();
  const row = await db.providerKey.upsert({
    where: { provider },
    update: {
      keyEnc: encryptSecret(key),
      status: check.status,
      statusMessage: check.message,
      lastCheckedAt: now,
    },
    create: {
      provider,
      keyEnc: encryptSecret(key),
      status: check.status,
      statusMessage: check.message,
      lastCheckedAt: now,
    },
  });
  invalidateProvidersCache();

  // WALLET-ECON-1 — credential lifecycle audit (never the key itself).
  await logAudit({
    action: "provider-key.saved",
    actor: gate.session.uid,
    target: provider,
    detail: `${labelOf(provider)} API key saved — validation: ${check.status}.`,
    meta: { status: check.status, replaced: Boolean(rowsBefore) },
  });

  return NextResponse.json({ key: serialize(row), check });
}

/** Remove a stored key (the provider simply falls back to not configured). */
export async function DELETE(req: NextRequest) {
  const gate = await requireActiveAdmin(req);
  if ("error" in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const provider = req.nextUrl.searchParams.get("provider");
  if (!isProviderId(provider)) {
    return NextResponse.json({ error: "Unknown provider." }, { status: 400 });
  }
  const removed = await db.providerKey.deleteMany({ where: { provider } });
  invalidateProvidersCache();
  await logAudit({
    action: "provider-key.removed",
    actor: gate.session.uid,
    target: provider,
    detail: `${labelOf(provider)} API key removed (${removed.count} row(s)).`,
  });
  return NextResponse.json({ ok: true });
}
