import { NextRequest, NextResponse } from "next/server";
import {
  listTriggerEvents,
  runTriggerPass,
  approveTrigger,
  dismissTrigger,
  actOnTrigger,
} from "@/lib/infranex/triggers";
import { runUidDefensePass, getUidDefensePayload } from "@/lib/infranex/uid-defense";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

// GET /api/triggers — open + recent events, plus UID-defense telemetry
// (latest + 40-sample history per started deployment).
export async function GET() {
  try {
    const events = await listTriggerEvents();
    let uid: Awaited<ReturnType<typeof getUidDefensePayload>> = [];
    try {
      uid = await getUidDefensePayload();
    } catch {
      // chain unavailable — uid payload empty rather than failing the route
    }
    return NextResponse.json({ ok: true, ...events, uid });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// POST /api/triggers — { action: "run" | "approve" | "dismiss" | "act", id? }
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { action?: string; id?: string };
    switch (body.action) {
      case "run": {
        const pass = await runTriggerPass();
        // UID Defense rides on the same evaluation pass.
        let uidPass: Awaited<ReturnType<typeof runUidDefensePass>> | null = null;
        try {
          uidPass = await runUidDefensePass();
        } catch (e) {
          console.warn(`[triggers] uid pass skipped: ${e instanceof Error ? e.message : e}`);
        }
        const events = await listTriggerEvents();
        const uid = await getUidDefensePayload().catch(() => []);
        return NextResponse.json({
          ok: true,
          pass: {
            ...pass,
            uidEvaluated: uidPass?.evaluated ?? 0,
            uidSkipped: uidPass?.skipped ?? 0,
          },
          ...events,
          uid,
        });
      }
      case "approve": {
        if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
        const event = await approveTrigger(body.id);
        return NextResponse.json({ ok: true, event });
      }
      case "dismiss": {
        if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
        const event = await dismissTrigger(body.id);
        return NextResponse.json({ ok: true, event });
      }
      case "act": {
        if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
        const { event, action } = await actOnTrigger(body.id);
        return NextResponse.json({ ok: true, event, action });
      }
      default:
        return NextResponse.json(
          { error: 'action must be one of "run" | "approve" | "dismiss" | "act"' },
          { status: 400 }
        );
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
