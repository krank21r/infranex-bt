import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireActiveUser } from "@/lib/auth-admin";
import { SS58_RE } from "@/lib/infranex/runway";
import { logAudit } from "@/lib/infranex/audit";

// WALLET-ECON-1 — per-profile wallet registry operations: update fields,
// set as fleet default (exclusive), delete (deployments referencing it are
// detached, not deleted). Public metadata only — same policy as the
// collection route.

export const dynamic = "force-dynamic";

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function sanitizeAddress(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  return SS58_RE.test(s) ? s : null;
}

/** Patch a profile; `{ isDefault: true }` makes it the fleet default. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireActiveUser(req);
  if ("error" in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { id } = await ctx.params;
  const row = await db.walletProfile.findUnique({ where: { id } });
  if (!row) {
    return NextResponse.json({ error: "Wallet profile not found." }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const data: Record<string, unknown> = {};

  if (typeof body?.label === "string" && body.label.trim()) {
    data.label = body.label.trim().slice(0, 80);
  }
  if (typeof body?.walletName === "string") {
    if (!NAME_RE.test(body.walletName.trim())) {
      return NextResponse.json({ error: "Invalid wallet name." }, { status: 400 });
    }
    data.walletName = body.walletName.trim();
  }
  if (typeof body?.hotkeyName === "string") {
    if (!NAME_RE.test(body.hotkeyName.trim())) {
      return NextResponse.json({ error: "Invalid hotkey name." }, { status: 400 });
    }
    data.hotkeyName = body.hotkeyName.trim();
  }
  if ("coldAddress" in (body ?? {})) data.coldAddress = sanitizeAddress(body?.coldAddress);
  if ("hotAddress" in (body ?? {})) data.hotAddress = sanitizeAddress(body?.hotAddress);
  if (typeof body?.notes === "string") data.notes = body.notes.slice(0, 500);

  try {
    const updated = await db.$transaction(async (tx) => {
      if (body?.isDefault === true) {
        await tx.walletProfile.updateMany({ data: { isDefault: false } });
        data.isDefault = true;
        await tx.platformSettings.upsert({
          where: { id: 1 },
          update: { defaultWalletProfileId: id },
          create: { id: 1, defaultWalletProfileId: id },
        });
      } else if (body?.isDefault === false) {
        data.isDefault = false;
        const settings = await tx.platformSettings.findUnique({ where: { id: 1 } });
        if (settings?.defaultWalletProfileId === id) {
          await tx.platformSettings.update({
            where: { id: 1 },
            data: { defaultWalletProfileId: null },
          });
        }
      }
      return tx.walletProfile.update({ where: { id }, data });
    });

    await logAudit({
      action: "wallet.saved",
      actor: gate.session.uid,
      target: id,
      detail: `Wallet profile "${updated.label}" updated${body?.isDefault === true ? " and set as default" : ""}.`,
    });
    return NextResponse.json({
      wallet: {
        id: updated.id,
        label: updated.label,
        walletName: updated.walletName,
        hotkeyName: updated.hotkeyName,
        coldAddress: updated.coldAddress,
        hotAddress: updated.hotAddress,
        notes: updated.notes,
        isDefault: updated.isDefault,
        createdAt: updated.createdAt.toISOString(),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "A profile with that wallet/hotkey name pair already exists." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Could not update wallet profile." }, { status: 500 });
  }
}

/** Delete a profile (referencing deployments are detached, not deleted). */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireActiveUser(req);
  if ("error" in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { id } = await ctx.params;
  const row = await db.walletProfile.findUnique({ where: { id } });
  if (!row) {
    return NextResponse.json({ error: "Wallet profile not found." }, { status: 404 });
  }

  await db.$transaction([
    db.deployment.updateMany({ where: { walletProfileId: id }, data: { walletProfileId: null } }),
    db.platformSettings.updateMany({
      where: { defaultWalletProfileId: id },
      data: { defaultWalletProfileId: null },
    }),
    db.walletProfile.delete({ where: { id } }),
  ]);

  await logAudit({
    action: "wallet.removed",
    actor: gate.session.uid,
    target: id,
    detail: `Wallet profile "${row.label}" (${row.walletName}/${row.hotkeyName}) removed.`,
  });
  return NextResponse.json({ ok: true });
}
