import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toRuleDTO } from "@/lib/infranex/autopilot";
import { TRIGGER_KIND_META } from "@/lib/infranex/triggers-core";

export const dynamic = "force-dynamic";

/**
 * TIER3 — Autopilot policy rules.
 *
 *   GET   → all rules (newest first)
 *   POST  → create a rule { name, kind, minSeverity, maxPerHour }
 *           or { action: "run" } to execute one autopilot pass now.
 *
 * Auth is enforced by the proxy (all /api/* gated).
 */

const VALID_MIN_SEVERITY = new Set(["info", "warning", "critical"]);

export async function GET() {
  const rules = await db.autopilotRule.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ rules: rules.map(toRuleDTO) });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.action === "run") {
    const { runAutopilotPass } = await import("@/lib/infranex/autopilot");
    const result = await runAutopilotPass();
    return NextResponse.json({ ok: true, result });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2 || name.length > 80) {
    return NextResponse.json({ error: "name must be 2-80 characters" }, { status: 400 });
  }

  const kind = typeof body.kind === "string" && body.kind ? body.kind : "ANY";
  if (kind !== "ANY" && !(kind in TRIGGER_KIND_META)) {
    return NextResponse.json(
      { error: `unknown kind "${kind}" — use ANY or a trigger kind` },
      { status: 400 }
    );
  }
  if (kind === "KILL" || kind === "ESCALATION") {
    return NextResponse.json(
      { error: "KILL and ESCALATION are human-only — autopilot can never act on them" },
      { status: 400 }
    );
  }

  const minSeverity = typeof body.minSeverity === "string" ? body.minSeverity : "warning";
  if (!VALID_MIN_SEVERITY.has(minSeverity)) {
    return NextResponse.json({ error: "minSeverity must be info | warning | critical" }, { status: 400 });
  }

  const maxPerHour =
    typeof body.maxPerHour === "number" && Number.isFinite(body.maxPerHour)
      ? Math.max(1, Math.min(60, Math.floor(body.maxPerHour)))
      : 3;

  const rule = await db.autopilotRule.create({
    data: { name, kind, minSeverity, maxPerHour },
  });
  return NextResponse.json({ ok: true, rule: toRuleDTO(rule) });
}
