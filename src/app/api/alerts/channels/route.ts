import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  createChannel,
  channelHint,
  isChannelKind,
  type AlertChannelKind,
} from "@/lib/infranex/alerts";

export const dynamic = "force-dynamic";

/**
 * TIER4 — external alerting channels.
 *
 *   GET   → all channels (URL masked to a hint — never the plaintext)
 *   POST  → create a channel (ADMIN-ONLY) { name, kind, url, minSeverity, digest }
 *
 * The proxy guarantees a valid session for GET; mutations re-verify the role.
 */

async function requireAdmin(req: NextRequest) {
  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return { error: "Not signed in", status: 401 as const };
  if (session.role !== "admin") {
    return { error: "Admin privileges required.", status: 403 as const };
  }
  return { session };
}

export async function GET() {
  const rows = await db.alertChannel.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({
    channels: rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      urlHint: channelHint(r),
      minSeverity: r.minSeverity,
      digest: r.digest,
      enabled: r.enabled,
      lastStatus: r.lastStatus,
      lastError: r.lastError,
      lastSentAt: r.lastSentAt?.toISOString() ?? null,
      sentCount: r.sentCount,
      failCount: r.failCount,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if ("error" in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  try {
    const body = (await req.json()) as {
      name?: unknown;
      kind?: unknown;
      url?: unknown;
      minSeverity?: unknown;
      digest?: unknown;
    };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 2) {
      return NextResponse.json({ error: "Channel name must be at least 2 characters" }, { status: 400 });
    }
    if (!isChannelKind(body.kind)) {
      return NextResponse.json(
        { error: 'kind must be one of "generic", "slack", "discord"' },
        { status: 400 }
      );
    }
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) {
      return NextResponse.json({ error: "Webhook URL is required" }, { status: 400 });
    }
    const channel = await createChannel({
      name,
      kind: body.kind as AlertChannelKind,
      url,
      minSeverity: typeof body.minSeverity === "string" ? body.minSeverity : undefined,
      digest: typeof body.digest === "boolean" ? body.digest : undefined,
    });
    return NextResponse.json({ channel: { id: channel.id, name: channel.name } }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create channel" },
      { status: 400 }
    );
  }
}
