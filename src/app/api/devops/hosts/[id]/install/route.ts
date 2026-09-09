// Host install API — the Requirement Installer.
//   GET  → latest install job for this host (steps + status)
//   POST → stage a new install: { netuid, walletName, hotkeyName }
//          pulls the subnet requirements profile, builds the 9-step plan,
//          persists it as "staged" (nothing runs until steps are executed).

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pullSubnetRequirements } from "@/lib/devops/subnet-requirements";
import { buildInstallPlan } from "@/lib/devops/installer";
import type { HostFacts } from "@/lib/devops/inspector";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const row = await db.hostInstall.findFirst({
    where: { hostId: id },
    orderBy: { updatedAt: "desc" },
  });
  if (!row) return NextResponse.json({ install: null });
  return NextResponse.json({ install: parseInstall(row) });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const host = await db.gpuHost.findUnique({ where: { id } });
    if (!host) return NextResponse.json({ error: "host not found" }, { status: 404 });

    const body = (await req.json()) as Record<string, unknown>;
    const netuid = parseInt(String(body.netuid ?? ""), 10);
    const walletName = String(body.walletName ?? "").trim();
    const hotkeyName = String(body.hotkeyName ?? "").trim();
    if (!Number.isFinite(netuid)) return NextResponse.json({ error: "netuid is required" }, { status: 400 });
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(walletName))
      return NextResponse.json({ error: "walletName: 1-32 chars [a-zA-Z0-9_-]" }, { status: 400 });
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(hotkeyName))
      return NextResponse.json({ error: "hotkeyName: 1-32 chars [a-zA-Z0-9_-]" }, { status: 400 });

    const { profile } = await pullSubnetRequirements(netuid);
    let facts: HostFacts | null = null;
    try {
      facts = host.hostInfo ? (JSON.parse(host.hostInfo) as HostFacts) : null;
    } catch {
      facts = null;
    }
    const steps = buildInstallPlan({ profile, walletName, hotkeyName, hostFacts: facts });

    // Retire any previous non-terminal installs for this host.
    await db.hostInstall.updateMany({
      where: { hostId: id, status: { in: ["staged", "running", "waiting_approval", "failed"] } },
      data: { status: "stopped" },
    });

    const created = await db.hostInstall.create({
      data: {
        hostId: id,
        netuid,
        subnetName: profile.subnetName,
        walletName,
        hotkeyName,
        status: "staged",
        requirementsJson: JSON.stringify(profile),
        stepsJson: JSON.stringify(steps),
      },
    });
    return NextResponse.json({ install: parseInstall(created) }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "stage failed" },
      { status: 500 }
    );
  }
}

function parseInstall(row: {
  id: string;
  hostId: string;
  netuid: number;
  subnetName: string;
  walletName: string;
  hotkeyName: string;
  status: string;
  requirementsJson: string;
  stepsJson: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  let profile: unknown = null;
  let steps: unknown = [];
  try {
    profile = JSON.parse(row.requirementsJson);
    steps = JSON.parse(row.stepsJson);
  } catch {
    steps = [];
  }
  return { ...row, requirementsJson: undefined, stepsJson: undefined, profile, steps };
}
