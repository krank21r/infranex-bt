import { NextRequest, NextResponse } from "next/server";
import { listRevisions, rollbackToRevision } from "@/lib/infranex/deployment/revisions";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * TIER2 — deployment config revision history + rollback (spec §20/§25).
 *
 *   GET            → newest-first revision chain with isCurrent flags
 *   POST { rev }   → roll the deployment's config back to that revision
 *                    (restores config + requirements, pushes apply_config
 *                    via daemon / ticks mocks) and return the result note.
 *
 * Session enforcement happens in the proxy (all /api/* is gated); the token
 * here is read only to attribute the rollback to an operator.
 */

async function actorOf(req: NextRequest): Promise<string> {
  const payload = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  return payload?.uid ?? "operator";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const revisions = await listRevisions(id);
    return NextResponse.json({ revisions });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to list revisions" },
      { status: 404 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: { rev?: unknown };
  try {
    body = (await req.json()) as { rev?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const rev = typeof body.rev === "number" ? Math.floor(body.rev) : NaN;
  if (!Number.isFinite(rev) || rev < 1) {
    return NextResponse.json({ error: "body.rev must be a positive revision number" }, { status: 400 });
  }

  try {
    const result = await rollbackToRevision(id, rev, { actor: await actorOf(req) });
    return NextResponse.json({ rollback: result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Rollback failed" },
      { status: 400 }
    );
  }
}
