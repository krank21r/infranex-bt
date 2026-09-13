import { NextRequest, NextResponse } from "next/server";
import { migrateDeployment } from "@/lib/infranex/deployment/migrate";
import type { GPUOffer } from "@/lib/infranex/types";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * TIER3 — migrate a started deployment to a new GPU offer.
 *
 *   POST { offerId }                 → pick the offer from the live catalog
 *   POST { offer: {...} }            → explicit offer fields (mock fleet)
 *
 * Session enforcement happens in the proxy; the token here is read only to
 * attribute the migration to an operator (same pattern as revisions).
 */

function isOfferLike(v: unknown): v is Partial<GPUOffer> {
  return !!v && typeof v === "object" && typeof (v as GPUOffer).model === "string";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const payload = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const actor = payload?.uid ?? "operator";

  let body: { offerId?: unknown; offer?: unknown };
  try {
    body = (await req.json()) as { offerId?: unknown; offer?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let offer: GPUOffer | null = null;

  if (typeof body.offerId === "string" && body.offerId) {
    const { fetchAllLiveOffers } = await import("@/lib/infranex/providers");
    const snap = await fetchAllLiveOffers();
    offer = snap.offers.find((o) => o.id === body.offerId) ?? null;
    if (!offer) {
      return NextResponse.json(
        { error: `Offer "${body.offerId}" not found in the live catalog — refresh and retry` },
        { status: 400 }
      );
    }
  } else if (isOfferLike(body.offer)) {
    const o = body.offer as Partial<GPUOffer>;
    if (typeof o.model !== "string" || !o.model) {
      return NextResponse.json({ error: "offer.model must be a non-empty string" }, { status: 400 });
    }
    offer = {
      id: typeof o.id === "string" ? o.id : `custom-${Date.now()}`,
      model: o.model,
      vramGb: typeof o.vramGb === "number" ? o.vramGb : 0,
      provider: typeof o.provider === "string" ? o.provider : "mock",
      region: typeof o.region === "string" ? o.region : "unknown",
      hourlyPrice: typeof o.hourlyPrice === "number" ? o.hourlyPrice : 0,
      monthlyPrice: typeof o.monthlyPrice === "number" ? o.monthlyPrice : 0,
      availability: "available",
      isSpot: o.isSpot === true,
      ramGb: typeof o.ramGb === "number" ? o.ramGb : 0,
      cpuCores: typeof o.cpuCores === "number" ? o.cpuCores : 0,
    };
  } else {
    return NextResponse.json(
      { error: "body.offerId or body.offer is required" },
      { status: 400 }
    );
  }

  if (!offer) {
    return NextResponse.json({ error: "No valid offer provided" }, { status: 400 });
  }

  try {
    const result = await migrateDeployment(id, { offer }, { actor });
    return NextResponse.json({ ok: true, migration: result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Migration failed" },
      { status: 400 }
    );
  }
}
