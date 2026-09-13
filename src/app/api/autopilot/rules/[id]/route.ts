import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toRuleDTO } from "@/lib/infranex/autopilot";
import { TRIGGER_KIND_META } from "@/lib/infranex/triggers-core";

export const dynamic = "force-dynamic";

/**
 * TIER3 — one autopilot rule.
 *
 *   PATCH  → { enabled?, name?, minSeverity?, mockOnly?, maxPerHour?, kind? }
 *   DELETE → remove the rule
 */

const VALID_MIN_SEVERITY = new Set(["info", "warning", "critical"]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existing = await db.autopilotRule.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;
  if (typeof body.mockOnly === "boolean") data.mockOnly = body.mockOnly;
  if (typeof body.name === "string" && body.name.trim().length >= 2) data.name = body.name.trim();
  if (typeof body.minSeverity === "string") {
    if (!VALID_MIN_SEVERITY.has(body.minSeverity)) {
      return NextResponse.json({ error: "minSeverity must be info | warning | critical" }, { status: 400 });
    }
    data.minSeverity = body.minSeverity;
  }
  if (typeof body.maxPerHour === "number" && Number.isFinite(body.maxPerHour)) {
    data.maxPerHour = Math.max(1, Math.min(60, Math.floor(body.maxPerHour)));
  }
  if (typeof body.kind === "string" && body.kind) {
    if (body.kind !== "ANY" && !(body.kind in TRIGGER_KIND_META)) {
      return NextResponse.json({ error: `unknown kind "${body.kind}"` }, { status: 400 });
    }
    if (body.kind === "KILL" || body.kind === "ESCALATION") {
      return NextResponse.json({ error: "KILL and ESCALATION are human-only" }, { status: 400 });
    }
    data.kind = body.kind;
  }

  const rule = await db.autopilotRule.update({ where: { id }, data });
  return NextResponse.json({ ok: true, rule: toRuleDTO(rule) });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existing = await db.autopilotRule.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }
  await db.autopilotRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
