import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireActiveAdmin } from "@/lib/auth-admin";

// WALLET-ECON-1 — audit trail read access (admin-only). Append-only: there
// is no edit/delete API on purpose. Newest first, capped page size.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await requireActiveAdmin(req);
  if ("error" in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 50;

  const rows = await db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({
    entries: rows.map((r) => ({
      id: r.id,
      action: r.action,
      actor: r.actor,
      target: r.target,
      detail: r.detail,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
