// ---------------------------------------------------------------------------
// WINDUP-1 — shared route gates with DB-backed session revocation.
//
// The proxy (Edge runtime, Web Crypto only) verifies the token signature and
// expiry but CANNOT reach the database. These Node-runtime helpers are the
// privilege gates for sensitive routes: on top of signature + expiry they
// re-check the AppUser row, so an admin's `setActive(false)` revokes a live
// token on the very next gated call instead of after the cookie's full TTL.
// (Token role is also re-checked here; the payload's role is trusted only
// up to this DB round-trip.)
//
// Fail-open policy: if the AppUser row cannot be read (DB hiccup), the gate
// falls back to the proxy-verified identity rather than locking operators
// out — the user row is only deleted via the same admin panel that disables.
// ---------------------------------------------------------------------------

import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken, type SessionPayload } from "@/lib/auth";
import { db } from "@/lib/db";

export type ActiveGate =
  | { session: SessionPayload }
  | { error: string; status: 401 | 403 };

async function gate(req: NextRequest, requireAdminRole: boolean): Promise<ActiveGate> {
  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return { error: "Not signed in", status: 401 };

  // Revocation check — a deactivated account's token is dead immediately.
  const row = await db.appUser
    .findUnique({ where: { userId: session.uid }, select: { active: true } })
    .catch(() => null);
  if (row && !row.active) {
    return { error: "Account disabled — ask an admin to reactivate it.", status: 403 };
  }

  if (requireAdminRole && session.role !== "admin") {
    return { error: "Admin privileges required.", status: 403 };
  }
  return { session };
}

/** Valid session + account still active + role "admin". */
export function requireActiveAdmin(req: NextRequest): Promise<ActiveGate> {
  return gate(req, true);
}

/** Valid session + account still active (any role). */
export function requireActiveUser(req: NextRequest): Promise<ActiveGate> {
  return gate(req, false);
}
