// Run ONE install step: POST { action: "run" | "override" }.
// "override" only applies to the manual wallet gate (user confirms files).

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/devops/crypto";
import { runInstallStep } from "@/lib/devops/installer";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; stepId: string }> }
) {
  const { id, stepId } = await ctx.params;
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    const action = body.action === "override" ? "override" : "run";

    const host = await db.gpuHost.findUnique({ where: { id } });
    if (!host) return NextResponse.json({ error: "host not found" }, { status: 404 });

    let secret = "";
    try {
      secret = decryptSecret(host.secretEnc);
    } catch {
      return NextResponse.json({ error: "could not decrypt host credentials" }, { status: 500 });
    }

    const { install, step } = await runInstallStep(host, secret, stepId, action);
    return NextResponse.json({ install, step });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "step failed" },
      { status: 400 }
    );
  }
}
