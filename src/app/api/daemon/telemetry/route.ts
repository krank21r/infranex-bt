import { NextRequest, NextResponse } from "next/server";
import { getDaemonForRequest, recordTelemetry } from "@/lib/infranex/daemon-bridge";
import { ingestMinerLogs } from "@/lib/infranex/miner-logs";

export const dynamic = "force-dynamic";

// POST /api/daemon/telemetry — HMAC-signed telemetry from the Node Daemon.
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
    const telemetry = JSON.parse(raw) as Record<string, unknown>;
    await recordTelemetry(deploymentId, telemetry);
    // TIER1-1 — daemon v3 tails the miner log; store new lines (deduped).
    if (Array.isArray(telemetry.logs) && telemetry.logs.length > 0) {
      await ingestMinerLogs(deploymentId, telemetry.logs as Record<string, unknown>[]).catch(() => 0);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "bad telemetry" },
      { status: 400 }
    );
  }
}
