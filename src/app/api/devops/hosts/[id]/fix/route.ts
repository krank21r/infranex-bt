// DevOps Engine — apply the fix for a failed pipeline step, re-check it.
// Body: { step: number }

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/devops/crypto";
import { applyStepFix, PIPELINE } from "@/lib/devops/inspector";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const body = (await req.json()) as { step?: number };
    const step = Number(body.step);
    if (!Number.isInteger(step) || step < 1 || step > 10)
      return NextResponse.json({ error: "step must be 1-10" }, { status: 400 });

    const host = await db.gpuHost.findUnique({ where: { id } });
    if (!host) return NextResponse.json({ error: "not found" }, { status: 404 });

    const def = PIPELINE.find((d) => d.step === step);
    if (!def?.fix)
      return NextResponse.json(
        { error: `Step ${step} has no automatic fix (manual remediation required)` },
        { status: 400 }
      );

    const secret = decryptSecret(host.secretEnc);
    const result = await applyStepFix(host, secret, step);
    return NextResponse.json({ result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "fix failed" },
      { status: 500 }
    );
  }
}
