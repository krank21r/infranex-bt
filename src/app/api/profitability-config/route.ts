import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  sanitizeProfitabilityConfig,
  DEFAULT_PROFITABILITY_CONFIG,
  type ProfitabilityConfig,
} from "@/lib/infranex/profitability";

export const dynamic = "force-dynamic";

// The Profitability Engine settings singleton (id = 1).
// GET  /api/profitability-config — current config (creates the default row on first read)
// PUT  /api/profitability-config — update the config (the $300 minimum entry rule lives here)

async function readOrCreate(): Promise<ProfitabilityConfig> {
  const row = await db.profitabilitySettings.findUnique({ where: { id: 1 } });
  if (row) return sanitizeProfitabilityConfig(row);
  const created = await db.profitabilitySettings.create({ data: { id: 1 } });
  return sanitizeProfitabilityConfig(created);
}

export async function GET() {
  try {
    const config = await readOrCreate();
    return NextResponse.json(config, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch {
    // DB unavailable — serve defaults so the engine still runs.
    return NextResponse.json(DEFAULT_PROFITABILITY_CONFIG, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }
}

export async function PUT(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const config = sanitizeProfitabilityConfig(body);
  try {
    await db.profitabilitySettings.upsert({
      where: { id: 1 },
      update: { ...config },
      create: { id: 1, ...config },
    });
    return NextResponse.json(config);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed to save" },
      { status: 500 }
    );
  }
}
