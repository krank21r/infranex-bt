// /api/admin/users — ADMINPANEL-1 credential management (ADMIN-ONLY).
//
// Every handler re-verifies the session AND requires role === "admin".
// The proxy guarantees a valid session exists; the role check here is the
// actual privilege gate (members hitting this API get 403).
//
// GET                    → list all users incl. current codes (decrypted)
// POST { action }        → "regenerate" { userId }  → new code (returned)
//                          "setActive"  { userId, active }
// Every mutation re-mirrors scripts/users.local.json + the /tmp wipe-proof
// copy, so the files NEVER drift from the database.

import { NextRequest, NextResponse } from "next/server";
import { requireActiveAdmin } from "@/lib/auth-admin";
import {
  listUsersWithCodes,
  regenerateUserCode,
  setUserActive,
} from "@/lib/auth-users";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await requireActiveAdmin(req);
  if ("error" in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const users = await listUsersWithCodes();
  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const gate = await requireActiveAdmin(req);
  if ("error" in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const body = (await req.json().catch(() => null)) as {
    action?: string;
    userId?: string;
    active?: boolean;
  } | null;
  const userId = body?.userId?.trim();

  if (body?.action === "regenerate") {
    if (!userId) {
      return NextResponse.json({ error: "userId is required." }, { status: 400 });
    }
    try {
      const code = await regenerateUserCode(userId);
      return NextResponse.json({ ok: true, userId, code });
    } catch {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }
  }

  if (body?.action === "setActive") {
    if (!userId || typeof body.active !== "boolean") {
      return NextResponse.json(
        { error: "userId and boolean active are required." },
        { status: 400 }
      );
    }
    if (gate.session.uid === userId && !body.active) {
      return NextResponse.json(
        { error: "You cannot disable your own admin account." },
        { status: 400 }
      );
    }
    const result = await setUserActive(userId, body.active);
    return NextResponse.json({ ok: true, ...result });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
