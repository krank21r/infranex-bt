import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  checkRegistration,
  attachHotkey,
  restartAfterRegistration,
  isValidSs58,
} from "@/lib/infranex/deployment/registration";

export const dynamic = "force-dynamic";

/** Wizard hand-off context — real commands for THIS deployment. */
function wizardContext(row: {
  id: string;
  minerName: string;
  netuid: number;
  subnetName: string;
  hotkey: string | null;
  sshHost: string | null;
  config: string | null;
  requirementsJsonSnapshot: string | null;
}) {
  const config = row.config
    ? (JSON.parse(row.config) as { miner?: { walletName?: string; hotkeyName?: string } })
    : null;
  const walletName = config?.miner?.walletName ?? "infranex";
  const hotkeyName = config?.miner?.hotkeyName ?? "default";
  const profile = row.requirementsJsonSnapshot
    ? (JSON.parse(row.requirementsJsonSnapshot) as {
        dockerfileFound?: boolean;
        dockerImage?: string | null;
      })
    : null;
  const installMode: "docker" | "venv" | null =
    profile?.dockerfileFound && profile?.dockerImage ? "docker" : profile ? "venv" : null;
  const host = row.sshHost ?? "<HOST_IP>";
  const unit = `infranex-miner-sn${row.netuid}`;
  return {
    deploymentId: row.id,
    minerName: row.minerName,
    netuid: row.netuid,
    subnetName: row.subnetName,
    walletName,
    hotkeyName,
    sshHost: row.sshHost,
    installMode,
    scpCommand: `scp -r ~/.bittensor/wallets/${walletName} root@${host}:~/.bittensor/wallets/`,
    restartCommand:
      installMode === "docker"
        ? `ssh root@${host} docker restart ${unit}`
        : `ssh root@${host} sudo systemctl restart ${unit}`,
  };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const force = new URL(req.url).searchParams.get("force") === "1";
    const row = await db.deployment.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const registration = await checkRegistration(id, { force });
    return NextResponse.json({ registration, wizard: wizardContext(row) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      hotkey?: string;
    };
    const row = await db.deployment.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    switch (body.action) {
      case "attach-hotkey": {
        if (!body.hotkey || !isValidSs58(body.hotkey)) {
          return NextResponse.json(
            { error: "Not a valid hotkey SS58 address (48 characters, starts with '5')" },
            { status: 400 }
          );
        }
        const registration = await attachHotkey(id, body.hotkey);
        return NextResponse.json({ registration, wizard: wizardContext(row) });
      }
      case "check": {
        const registration = await checkRegistration(id, { force: true });
        return NextResponse.json({ registration, wizard: wizardContext(row) });
      }
      case "restart": {
        const result = await restartAfterRegistration(id);
        if (!result.ok) {
          return NextResponse.json({ error: result.output.join("\n") }, { status: 500 });
        }
        const fresh = await db.deployment.findUnique({ where: { id } });
        return NextResponse.json({ ok: true, output: result.output, deployment: fresh });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
