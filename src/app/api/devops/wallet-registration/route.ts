import { NextRequest, NextResponse } from "next/server";
import { getUidState } from "@/lib/infranex/metagraph";

/**
 * GET /api/devops/wallet-registration?netuid=90&hotkey=5...
 *
 * Live on-chain verification for the Wallet & Registration wizard: answers
 * "did my hotkey actually land on this subnet?" by scanning the metagraph
 * Keys map for the hotkey and returning its UID state, plus the subnet's
 * immunity window (and remaining immunity when the registration block is
 * exposed by the runtime).
 */

const SS58_RE = /^5[1-9A-HJ-NP-Za-km-z]{47}$/;

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const netuid = Number(url.searchParams.get("netuid"));
  const hotkey = (url.searchParams.get("hotkey") ?? "").trim();

  if (!Number.isInteger(netuid) || netuid < 1 || netuid > 1024) {
    return NextResponse.json(
      { ok: false, error: "netuid must be an integer between 1 and 1024" },
      { status: 400 }
    );
  }
  if (!SS58_RE.test(hotkey)) {
    return NextResponse.json(
      { ok: false, error: "hotkey must be a valid SS58 address (48 characters, starts with '5')" },
      { status: 400 }
    );
  }

  try {
    const state = await getUidState(netuid, hotkey);
    if (!state.vectors) {
      return NextResponse.json(
        { ok: false, error: "chain snapshot unavailable" },
        { status: 502 }
      );
    }
    const uid = state.uid;
    const v = state.vectors;
    const immunityBlocks = state.hyperparams.immunityPeriod;
    const registrationBlock = uid !== null ? state.registrationBlock : null;
    const remainingBlocks =
      uid !== null && immunityBlocks !== null && registrationBlock !== null
        ? Math.max(0, registrationBlock + immunityBlocks - v.blockNumber)
        : null;

    return NextResponse.json({
      ok: true,
      netuid,
      hotkey,
      registered: uid !== null,
      uid,
      blockNumber: v.blockNumber,
      registeredUids: state.cohort.registeredUids,
      active: uid !== null ? (v.active[uid] ?? null) : null,
      incentive: uid !== null ? (v.incentive[uid] ?? null) : null,
      consensus: uid !== null ? (v.consensus[uid] ?? null) : null,
      emissionRaw: uid !== null ? (v.emissionRaw[uid] ?? null) : null,
      lastUpdateAgeBlocks:
        uid !== null ? v.blockNumber - (v.lastUpdateBlock[uid] ?? v.blockNumber) : null,
      immunity: {
        blocks: immunityBlocks,
        registrationBlock,
        remainingBlocks,
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "chain query failed",
      },
      { status: 502 }
    );
  }
}
