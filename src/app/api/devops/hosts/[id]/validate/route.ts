// DevOps Engine — run/resume the 10-step validation pipeline for a host.
// Runs synchronously (mock < 2s; real host up to ~3 min on first docker pull).

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/devops/crypto";
import { runValidation } from "@/lib/devops/inspector";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const host = await db.gpuHost.findUnique({ where: { id } });
    if (!host) return NextResponse.json({ error: "not found" }, { status: 404 });

    await db.gpuHost.update({ where: { id }, data: { status: "validating" } });
    const secret = decryptSecret(host.secretEnc);
    const summary = await runValidation(host, secret);
    return NextResponse.json({ summary });
  } catch (e) {
    // Mark failed so the UI doesn't hang in "validating"
    await db.gpuHost
      .update({ where: { id }, data: { status: "failed" } })
      .catch(() => undefined);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "validation failed" },
      { status: 500 }
    );
  }
}
