// DevOps Engine — GPU host inventory: list + create.
// Secrets are encrypted at rest and NEVER returned to the client.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/devops/crypto";

export const dynamic = "force-dynamic";

function publicHost(h: {
  id: string;
  name: string;
  transport: string;
  host: string;
  port: number;
  user: string;
  authMethod: string;
  provider: string;
  status: string;
  autoFixSafe: boolean;
  hostInfo: string | null;
  createdAt: Date;
}) {
  let info: unknown = null;
  try {
    info = h.hostInfo ? JSON.parse(h.hostInfo) : null;
  } catch {
    info = null;
  }
  return { ...h, secretEnc: undefined, hostInfo: info, hasSecret: true };
}

export async function GET() {
  try {
    const hosts = await db.gpuHost.findMany({ orderBy: { createdAt: "desc" } });
    return NextResponse.json({ hosts: hosts.map(publicHost) });
  } catch (e) {
    return NextResponse.json(
      { hosts: [], error: e instanceof Error ? e.message : "db unavailable" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const name = String(body.name ?? "").trim();
    const transport = body.transport === "mock" ? "mock" : "ssh";
    const host = String(body.host ?? "").trim();
    const port = Math.min(Math.max(parseInt(String(body.port ?? 22), 10) || 22, 1), 65535);
    const user = String(body.user ?? "root").trim() || "root";
    const authMethod = body.authMethod === "key" ? "key" : "password";
    const secret = String(body.secret ?? "");

    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    if (transport === "ssh" && !host)
      return NextResponse.json({ error: "host is required" }, { status: 400 });
    if (transport === "ssh" && !secret)
      return NextResponse.json({ error: "password or private key is required" }, { status: 400 });

    const created = await db.gpuHost.create({
      data: {
        name,
        transport,
        host: transport === "mock" ? "mock.local" : host,
        port,
        user,
        authMethod,
        secretEnc: encryptSecret(secret),
        provider: transport === "mock" ? "mock" : "byo",
        status: "pending",
      },
    });
    return NextResponse.json({ host: publicHost(created) }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "create failed" },
      { status: 500 }
    );
  }
}
