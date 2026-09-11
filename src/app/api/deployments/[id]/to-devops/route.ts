import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/devops/crypto";
import { getDeployment } from "@/lib/infranex/deployment/engine";
import { ensureDaemon } from "@/lib/infranex/daemon-bridge";
import { HOTKEY_ONLY_POLICY_TEXT } from "@/lib/infranex/deployment/ssh-keys";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/deployments/[id]/to-devops — the one-click "Register to DevOps"
 * bridge: hands a provisioned pod over to the DevOps Engine as a managed
 * GPU host (SSH via the deployment's ephemeral ed25519 key), registers the
 * Node Daemon, and lets the 10-step validation pipeline take it from there.
 *
 * Security: only the PUBLIC hotkey ever goes to the machine. The SSH
 * private key is re-encrypted into the host inventory store.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const dep = await getDeployment(id);
    if (!dep) {
      return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
    }
    if (dep.mode !== "runpod") {
      return NextResponse.json(
        { error: "Only runpod deployments can be registered to DevOps (mock pods have no real host)" },
        { status: 400 }
      );
    }
    if (!dep.providerPodId) {
      return NextResponse.json({ error: "Deployment has no provisioned pod yet" }, { status: 400 });
    }
    if (!["provisioned", "ready", "deploying", "started"].includes(dep.status)) {
      return NextResponse.json(
        { error: `Deployment is ${dep.status} — advance it to provisioned first` },
        { status: 400 }
      );
    }

    const hostIp = dep.config?.docker?.envVars?.find((e) => e.name === "POD_IP")?.value ?? null;
    // The deployment's SSH private key (encrypted) is the host credential.
    // Read the ENCRYPTED key straight from the row — it never enters the
    // public DeploymentRecord shape.
    const depRow = await db.deployment.findUnique({ where: { id }, select: { sshPrivKeyEnc: true, sshPublicKey: true } });
    if (!depRow?.sshPublicKey) {
      return NextResponse.json(
        { error: "Deployment has no SSH keypair — was it provisioned by provider v2?" },
        { status: 400 }
      );
    }

    const privKey = depRow.sshPrivKeyEnc ? decryptSecret(depRow.sshPrivKeyEnc) : null;
    if (!privKey) {
      return NextResponse.json(
        { error: "SSH private key missing for deployment" },
        { status: 400 }
      );
    }

    // Reuse an existing host for this pod, else create one.
    const existing = await db.gpuHost.findFirst({
      where: { providerPodId: dep.providerPodId },
    });

    const hostRow = existing
      ? await db.gpuHost.update({
          where: { id: existing.id },
          data: { secretEnc: encryptSecret(privKey), status: "pending" },
        })
      : await db.gpuHost.create({
          data: {
            name: dep.minerName,
            transport: "ssh",
            host: hostIp ?? dep.providerPodId,
            port: dep.sshPort ?? 22,
            user: "root",
            secretEnc: encryptSecret(privKey),
            authMethod: "key",
            provider: "runpod",
            providerPodId: dep.providerPodId,
            status: "pending",
          },
        });

    // Register the Node Daemon so the Trigger Engine can reach this host.
    const daemon = await ensureDaemon(dep.id);

    return NextResponse.json({
      ok: true,
      hostId: hostRow.id,
      hostName: hostRow.name,
      daemonRegistered: true,
      nextStep: "Run the DevOps 10-step validation pipeline on this host.",
      policy: HOTKEY_ONLY_POLICY_TEXT,
      daemonSecretHint: `${daemon.secret.slice(0, 6)}…${daemon.secret.slice(-4)}`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
