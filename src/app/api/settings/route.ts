import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireActiveAdmin, requireActiveUser } from "@/lib/auth-admin";
import {
  getPlatformSettings,
  serializeSettings,
  isChainNetwork,
} from "@/lib/infranex/settings";
import { logAudit } from "@/lib/infranex/audit";

// WALLET-ECON-1 — platform settings. GET is session-gated (any role — the
// wizard reads the default wallet + network); PUT is ADMIN-ONLY. Settings
// changes are audited.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await requireActiveUser(req);
  if ("error" in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const row = await getPlatformSettings();
  return NextResponse.json({ settings: serializeSettings(row) });
}

export async function PUT(req: NextRequest) {
  const gate = await requireActiveAdmin(req);
  if ("error" in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const data: Record<string, unknown> = {};

  if ("chainNetwork" in (body ?? {})) {
    if (!isChainNetwork(body?.chainNetwork)) {
      return NextResponse.json(
        { error: 'chainNetwork must be "finney" or "test".' },
        { status: 400 }
      );
    }
    data.chainNetwork = body?.chainNetwork;
  }
  if ("registrationBufferTao" in (body ?? {})) {
    const v = Number(body?.registrationBufferTao);
    if (!Number.isFinite(v) || v < 0 || v > 1000) {
      return NextResponse.json(
        { error: "registrationBufferTao must be a number between 0 and 1000." },
        { status: 400 }
      );
    }
    data.registrationBufferTao = v;
  }
  if ("defaultWalletProfileId" in (body ?? {})) {
    const v = body?.defaultWalletProfileId;
    if (v === null || v === "") {
      data.defaultWalletProfileId = null;
    } else if (typeof v === "string") {
      const wallet = await db.walletProfile.findUnique({ where: { id: v } });
      if (!wallet) {
        return NextResponse.json({ error: "Unknown wallet profile id." }, { status: 400 });
      }
      data.defaultWalletProfileId = v;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const updated = await db.platformSettings.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data },
  });

  await logAudit({
    action: "settings.updated",
    actor: gate.session.uid,
    detail: `Platform settings updated: ${Object.keys(data).join(", ")}.`,
    meta: { fields: Object.keys(data).join(",") },
  });
  return NextResponse.json({ settings: serializeSettings(updated) });
}

/** Mark the master encryption key as backed up (admin, one-way timestamp). */
export async function POST(req: NextRequest) {
  const gate = await requireActiveAdmin(req);
  if ("error" in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const updated = await db.platformSettings.upsert({
    where: { id: 1 },
    update: { masterKeyBackedUpAt: new Date() },
    create: { id: 1, masterKeyBackedUpAt: new Date() },
  });
  await logAudit({
    action: "settings.master-key-acked",
    actor: gate.session.uid,
    detail: "Master encryption key (.devops-secret) marked as backed up.",
  });
  return NextResponse.json({ settings: serializeSettings(updated) });
}
