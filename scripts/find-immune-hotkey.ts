/**
 * Find hotkeys still inside their immunity window on a subnet — E2E fixture
 * for the UID Defense immunity countdown (needs a FRESH registration to show
 * the ticking "IMMUNE · Xh left" chip).
 * Run: bun scripts/find-immune-hotkey.ts [netuid ...]
 */
import { getChainApi } from "../src/lib/infranex/chain";
import { encodeAddress } from "@polkadot/util-crypto";

const netuids = process.argv.slice(2).map(Number).filter(Number.isInteger);
const targets = netuids.length ? netuids : [90, 8, 1, 64, 4, 18, 55, 62];

const api = await getChainApi();
const head = (await api.rpc.chain.getHeader()).number.toNumber();
const mod = api.query.subtensorModule as any;

async function scalar(name: string, netuid: number): Promise<number | null> {
  try {
    if (typeof mod[name] === "undefined") return null;
    const v = await mod[name](netuid);
    return v ? Number(v.toString()) : null;
  } catch {
    return null;
  }
}

for (const netuid of targets) {
  const n = await scalar("subnetworkN", netuid);
  const immunity = await scalar("immunityPeriod", netuid);
  if (!n || !immunity) {
    console.log(`α${netuid}: no metagraph data (n=${n}, immunity=${immunity})`);
    continue;
  }
  const args: [number, number][] = [];
  for (let uid = 0; uid < n; uid++) args.push([netuid, uid]);
  const keys = await mod.keys.multi(args);
  // blockAtRegistration may be a double map — try one multi; fall back per-uid.
  let regs: any[] | null = null;
  try {
    if (typeof mod.blockAtRegistration !== "undefined") {
      regs = await mod.blockAtRegistration.multi(args);
    }
  } catch {
    regs = null;
  }
  let found = 0;
  for (let uid = 0; uid < n; uid++) {
    const raw = (() => {
      const opt = regs?.[uid];
      if (!opt || opt.isEmpty) return null;
      const v = opt.value ?? opt.inner ?? opt;
      const num = Number(v.toString());
      return Number.isFinite(num) && num > 0 ? num : null;
    })();
    if (raw === null) continue;
    const remaining = raw + immunity - head;
    if (remaining > 0) {
      const keyOpt = keys[uid];
      const kb = keyOpt && (typeof keyOpt.isSome !== "boolean" || keyOpt.isSome)
        ? keyOpt.value ?? keyOpt.inner ?? keyOpt
        : null;
      const bytes = kb?.toU8a ? kb.toU8a() : kb;
      const ss58 = bytes && bytes.length === 32 ? encodeAddress(new Uint8Array(bytes), 42) : "?";
      console.log(
        `α${netuid} uid=${uid} IMMUNE remaining=${remaining} blocks (~${((remaining * 12) / 3600).toFixed(1)}h) regBlock=${raw} hotkey=${ss58}`
      );
      found++;
      if (found >= 5) break;
    }
  }
  if (found === 0) console.log(`α${netuid}: ${n} uids, none inside immunity window (head=${head}, immunity=${immunity})`);
}
process.exit(0);
