import { NextRequest, NextResponse } from "next/server";
import {
  listTriggerEvents,
  runTriggerPass,
  approveTrigger,
  dismissTrigger,
  actOnTrigger,
} from "@/lib/infranex/triggers";
import { runUidDefensePass, getUidDefensePayload } from "@/lib/infranex/uid-defense";
import { runDevopsPass } from "@/lib/infranex/devops-monitor";
import { runMinerMindsetPass } from "@/lib/infranex/miner-mindset";
import { runServiceHealthPass } from "@/lib/infranex/service-health";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { logAudit } from "@/lib/infranex/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** Actor attribution — the proxy already gates this route to sessions. */
async function actorOf(req: NextRequest): Promise<string> {
  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  return session?.uid ?? "unknown";
}

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
        // DEVOPS-1 — GPU health + subnet drift ride on the same pass.
        let devopsPass: Awaited<ReturnType<typeof runDevopsPass>> | null = null;
        try {
          devopsPass = await runDevopsPass();
        } catch (e) {
          console.warn(`[triggers] devops pass skipped: ${e instanceof Error ? e.message : e}`);
        }
        // DEVOPS-3 — Miner Mindset strategy pass rides on the same run.
        let mindsetPass: Awaited<ReturnType<typeof runMinerMindsetPass>> | null = null;
        try {
          mindsetPass = await runMinerMindsetPass();
        } catch (e) {
          console.warn(`[triggers] mindset pass skipped: ${e instanceof Error ? e.message : e}`);
        }
        // DEVOPS-4 — Service Health & Validator Traffic pass rides too.
        let servicePass: Awaited<ReturnType<typeof runServiceHealthPass>> | null = null;
        try {
          servicePass = await runServiceHealthPass();
        } catch (e) {
          console.warn(`[triggers] service pass skipped: ${e instanceof Error ? e.message : e}`);
        }
        const events = await listTriggerEvents();
        const uid = await getUidDefensePayload().catch(() => []);
        return NextResponse.json({
          ok: true,
          pass: {
            ...pass,
            uidEvaluated: uidPass?.evaluated ?? 0,
            uidSkipped: uidPass?.skipped ?? 0,
            devopsEvaluated: devopsPass?.deploymentsEvaluated ?? 0,
            devopsSamples: devopsPass?.samplesTaken ?? 0,
            mindsetEvaluated: mindsetPass?.deploymentsEvaluated ?? 0,
            serviceEvaluated: servicePass?.deploymentsEvaluated ?? 0,
            serviceProbes: servicePass?.probesTaken ?? 0,
          },
          ...events,
          uid,
        });
      }
      case "approve": {
        if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
        const event = await approveTrigger(body.id);
        await logAudit({
          action: "trigger.approved",
          actor: await actorOf(req),
          target: body.id,
          detail: `Trigger "${event?.kind ?? body.id}" approved — ${event?.title ?? ""}`,
        });
        return NextResponse.json({ ok: true, event });
      }
      case "dismiss": {
        if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
        const event = await dismissTrigger(body.id);
        await logAudit({
          action: "trigger.dismissed",
          actor: await actorOf(req),
          target: body.id,
          detail: `Trigger "${event?.kind ?? body.id}" dismissed — ${event?.title ?? ""}`,
        });
        return NextResponse.json({ ok: true, event });
      }
      case "act": {
        if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
        const { event, action } = await actOnTrigger(body.id);
        await logAudit({
          action: "trigger.acted",
          actor: await actorOf(req),
          target: body.id,
          detail: `Trigger "${event?.kind ?? body.id}" executed → ${action} — ${event?.title ?? ""}`,
        });
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
