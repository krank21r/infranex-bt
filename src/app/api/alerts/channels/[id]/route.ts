import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/devops/crypto";

export const dynamic = "force-dynamic";

/**
 * TIER4 — one alert channel: PATCH (ADMIN-ONLY) to update / enable / disable,
 * DELETE (ADMIN-ONLY) to remove. The stored webhook URL is never returned —
 * updates accept a new plaintext URL and re-encrypt.
 */

async function requireAdmin(req: NextRequest) {
  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return { error: "Not signed in", status: 401 as const };
  if (session.role !== "admin") {
    return { error: "Admin privileges required.", status: 403 as const };
  }
  return { session };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdmin(req);
  if ("error" in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { id } = await params;
  try {
    const body = (await req.json()) as {
      name?: unknown;
      url?: unknown;
      minSeverity?: unknown;
      digest?: unknown;
      enabled?: unknown;
    };
    const data: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim().length >= 2) {
      data.name = body.name.trim().slice(0, 80);
    }
    if (typeof body.url === "string" && body.url.trim()) {
      const url = body.url.trim();
      if (!/^https?:\/\//i.test(url)) {
        return NextResponse.json({ error: "Webhook URL must start with http:// or https://" }, { status: 400 });
      }
      data.urlEnc = encryptSecret(url);
    }
    if (body.minSeverity === "warning" || body.minSeverity === "critical") {
      data.minSeverity = body.minSeverity;
    }
    if (typeof body.digest === "boolean") data.digest = body.digest;
    if (typeof body.enabled === "boolean") data.enabled = body.enabled;

    const row = await db.alertChannel.update({ where: { id }, data });
    return NextResponse.json({
      channel: { id: row.id, name: row.name, enabled: row.enabled },
      ok: true,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update channel" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdmin(req);
  if ("error" in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { id } = await params;
  try {
    await db.alertChannel.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }
}
