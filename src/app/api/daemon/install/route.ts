import { NextRequest, NextResponse } from "next/server";
import { ensureDaemon, buildDaemonScript } from "@/lib/infranex/daemon-bridge";
import { getDeployment } from "@/lib/infranex/deployment/engine";

export const dynamic = "force-dynamic";

// POST /api/daemon/install { deploymentId } — register the daemon and return
// the one-shot install script (secret shown ONCE here).
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { deploymentId?: string; platformUrl?: string };
    const deploymentId = body.deploymentId?.trim();
    if (!deploymentId) {
      return NextResponse.json({ error: "deploymentId is required" }, { status: 400 });
    }
    const dep = await getDeployment(deploymentId);
    if (!dep) {
      return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
    }

    const { secret, created } = await ensureDaemon(deploymentId);
    const platformUrl =
      body.platformUrl?.trim() || process.env.INFRANEX_PLATFORM_URL || "http://localhost:3000";

    const minerCommand = dep.config?.docker?.command ?? "python3 neurons/miner.py";
    const script = buildDaemonScript({
      deploymentId,
      secret,
      platformUrl,
      minerCommand,
    });

    return NextResponse.json({
      ok: true,
      created,
      installCommand:
        `curl -fsSL ${platformUrl}/api/daemon/install-script?deploymentId=${deploymentId} | bash -s --` +
        `  # or paste the returned script directly`,
      script,
      secretHint: `${secret.slice(0, 6)}…${secret.slice(-4)} (full secret embedded in script)`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
