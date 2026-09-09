// Stop the deployed miner service on this host (safety stop).

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/devops/crypto";
import { stopInstall } from "@/lib/devops/installer";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const host = await db.gpuHost.findUnique({ where: { id } });
    if (!host) return NextResponse.json({ error: "host not found" }, { status: 404 });
    let secret = "";
    try {
      secret = decryptSecret(host.secretEnc);
    } catch {
      return NextResponse.json({ error: "could not decrypt host credentials" }, { status: 500 });
    }
    const res = await stopInstall(host, secret);
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "stop failed" },
      { status: 400 }
    );
  }
}
