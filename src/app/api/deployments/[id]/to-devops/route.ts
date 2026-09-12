import { NextRequest, NextResponse } from "next/server";
import { BridgeError, bridgeDeploymentToDevOps } from "@/lib/infranex/deployment/to-devops";
import { decryptSecret } from "@/lib/devops/crypto";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/deployments/[id]/to-devops — manual "Register to DevOps" bridge
 * (retry path). The AUTOMATIC hand-off lives in the deployment engine: the
 * moment a RunPod pod reaches RUNNING, bridgeDeploymentToDevOps fires and
 * the rented machine appears in the DevOps host inventory with its connect
 * info prefilled — no form, no re-typing. This route stays for retries and
 * for hosts bridged before FLOW-1.
 *
 * Security: only the PUBLIC hotkey ever goes to the machine. The SSH
 * private key is re-encrypted into the host inventory store.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const result = await bridgeDeploymentToDevOps(id);
    const daemonSecretHint = await daemonHint(id);
    return NextResponse.json({ ...result, daemonSecretHint });
  } catch (e) {
    if (e instanceof BridgeError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/** Same hint shape the route returned before FLOW-1 (first 6 + last 4 chars). */
async function daemonHint(id: string): Promise<string | null> {
  try {
    const row = await db.daemonState.findUnique({ where: { deploymentId: id } });
    if (!row) return null;
    const secret = decryptSecret(row.secretEnc);
    return `${secret.slice(0, 6)}…${secret.slice(-4)}`;
  } catch {
    return null;
  }
}
