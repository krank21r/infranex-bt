import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth-admin";
import { getEconomicsSummary } from "@/lib/infranex/economics";

// WALLET-ECON-1 — fleet economics read model: real daily spend (estimate
// accrual from the DevOps worker) + real daily earnings (chain emission
// deltas), per day and per deployment, over the requested window.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await requireActiveUser(req);
  if ("error" in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const daysRaw = Number(req.nextUrl.searchParams.get("days") ?? "30");
  const days =
    Number.isFinite(daysRaw) ? Math.min(Math.max(Math.trunc(daysRaw), 1), 90) : 30;

  const summary = await getEconomicsSummary(days);
  return NextResponse.json(summary);
}
