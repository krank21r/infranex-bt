// DevOps Engine — single host: detail (host + latest check per step) + delete.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { secretHint, decryptSecret } from "@/lib/devops/crypto";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const host = await db.gpuHost.findUnique({ where: { id } });
    if (!host) return NextResponse.json({ error: "not found" }, { status: 404 });

    // Latest check per step (fix runs append rows with newer timestamps).
    const recent = await db.hostCheck.findMany({
      where: { hostId: id },
      orderBy: { createdAt: "desc" },
      take: 60,
    });
    const latestPerStep = new Map<number, (typeof recent)[number]>();
    for (const c of recent) {
      if (!latestPerStep.has(c.step)) latestPerStep.set(c.step, c);
    }
    const checks = [...latestPerStep.values()].sort((a, b) => a.step - b.step);

    let info: unknown = null;
    try {
      info = host.hostInfo ? JSON.parse(host.hostInfo) : null;
    } catch {
      info = null;
    }

    return NextResponse.json({
      host: {
        ...host,
        secretEnc: undefined,
        secretHint: secretHint(decryptSecret(host.secretEnc)),
        hostInfo: info,
      },
      checks,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "db unavailable" },
      { status: 200 }
    );
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    await db.hostCheck.deleteMany({ where: { hostId: id } });
    await db.gpuHost.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "delete failed" },
      { status: 500 }
    );
  }
}
