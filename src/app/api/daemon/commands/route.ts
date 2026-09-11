import { NextRequest, NextResponse } from "next/server";
import {
  getDaemonForRequest,
  pullCommands,
  recordCommandResult,
} from "@/lib/infranex/daemon-bridge";

export const dynamic = "force-dynamic";

// POST /api/daemon/commands — daemon pulls its approved command queue,
// or posts a command result (both HMAC-signed).
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const ts = req.headers.get("x-infranex-timestamp") ?? "";
  const sig = req.headers.get("x-infranex-signature") ?? "";
  const deploymentId = req.headers.get("x-infranex-deployment") ?? "";

  const v = await getDaemonForRequest(deploymentId, ts, raw, sig);
  if (!v.ok) {
    return NextResponse.json({ error: v.error ?? "unauthorized" }, { status: 401 });
  }

  try {
    const body = JSON.parse(raw) as { pull?: boolean; result?: { id: string; result: string } };
    if (body.result?.id) {
      await recordCommandResult(deploymentId, body.result.id, body.result.result ?? "");
      return NextResponse.json({ ok: true });
    }
    if (body.pull) {
      const commands = await pullCommands(deploymentId);
      return NextResponse.json({ ok: true, commands });
    }
    return NextResponse.json({ error: "nothing to do" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "bad request" },
      { status: 400 }
    );
  }
}
