import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireActiveUser } from "@/lib/auth-admin";
import { SS58_RE } from "@/lib/infranex/runway";
import { logAudit } from "@/lib/infranex/audit";

// WALLET-ECON-1 — wallet profile registry. PUBLIC METADATA ONLY: wallet /
// hotkey names and SS58 addresses. The platform never accepts or stores
// wallet secrets (mnemonics, private keys) — requests containing obvious
// secret material are rejected outright.

export const dynamic = "force-dynamic";

/** btcli wallet/hotkey names are filesystem dirs — keep them shell-safe. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function sanitizeAddress(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  return SS58_RE.test(s) ? s : null;
}

function serialize(row: {
  id: string;
  label: string;
  walletName: string;
  hotkeyName: string;
  coldAddress: string | null;
  hotAddress: string | null;
  notes: string;
  isDefault: boolean;
  createdAt: Date;
}) {
  return {
    id: row.id,
    label: row.label,
    walletName: row.walletName,
    hotkeyName: row.hotkeyName,
    coldAddress: row.coldAddress,
    hotAddress: row.hotAddress,
    notes: row.notes,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
  };
}

/** List wallet profiles (default first). */
export async function GET(req: NextRequest) {
  const gate = await requireActiveUser(req);
  if ("error" in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const rows = await db.walletProfile.findMany({
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ wallets: rows.map(serialize) });
}

/** Create a wallet profile. */
export async function POST(req: NextRequest) {
  const gate = await requireActiveUser(req);
  if ("error" in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  const walletName = typeof body?.walletName === "string" ? body.walletName.trim() : "";
  const hotkeyName = typeof body?.hotkeyName === "string" ? body.hotkeyName.trim() : "";

  if (!label || label.length > 80) {
    return NextResponse.json({ error: "Label is required (max 80 chars)." }, { status: 400 });
  }
  if (!NAME_RE.test(walletName) || !NAME_RE.test(hotkeyName)) {
    return NextResponse.json(
      { error: "Wallet and hotkey names must be shell-safe (letters, digits, dot, dash, underscore)." },
      { status: 400 }
    );
  }
  // Hard secret-rejection: the registry is public-metadata only.
  const joined = JSON.stringify(body ?? {});
  if (/mnemonic|seed|private[_ ]?key|12[- ]?word/i.test(joined)) {
    return NextResponse.json(
      { error: "Wallet secrets are never stored here — keep mnemonics offline." },
      { status: 400 }
    );
  }
  const coldAddress = sanitizeAddress(body?.coldAddress);
  const hotAddress = sanitizeAddress(body?.hotAddress);
  if (typeof body?.coldAddress === "string" && body.coldAddress.trim() && !coldAddress) {
    return NextResponse.json({ error: "Coldkey address is not a valid SS58 string." }, { status: 400 });
  }
  if (typeof body?.hotAddress === "string" && body.hotAddress.trim() && !hotAddress) {
    return NextResponse.json({ error: "Hotkey address is not a valid SS58 string." }, { status: 400 });
  }
  const notes = typeof body?.notes === "string" ? body.notes.slice(0, 500) : "";

  try {
    const row = await db.walletProfile.create({
      data: {
        label,
        walletName,
        hotkeyName,
        coldAddress,
        hotAddress,
        notes,
      },
    });
    await logAudit({
      action: "wallet.saved",
      actor: gate.session.uid,
      target: row.id,
      detail: `Wallet profile "${label}" (${walletName}/${hotkeyName}) saved.`,
    });
    return NextResponse.json({ wallet: serialize(row) }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("Unique constraint")) {
      return NextResponse.json(
        { error: `Profile for ${walletName}/${hotkeyName} already exists.` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Could not save wallet profile." }, { status: 500 });
  }
}
