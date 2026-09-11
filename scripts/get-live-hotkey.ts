/**
 * Prints the SS58 hotkeys of the first few UIDs of a subnet (for E2E testing
 * of the wallet-registration verifier). Run: bun scripts/get-live-hotkey.ts [netuid]
 */
import { getChainApi } from "../src/lib/infranex/chain";
import { encodeAddress } from "@polkadot/util-crypto";

const netuid = Number(process.argv[2] ?? 90);

const api = await getChainApi();
const head = await api.rpc.chain.getHeader();
console.log(`connected — head block #${head.number.toNumber()}`);
const args: [number, number][] = [];
for (let uid = 0; uid < 6; uid++) args.push([netuid, uid]);
const results = await (api.query.subtensorModule.keys as any).multi(args);
console.log(`raw results: ${results?.length ?? "undefined"}`);
const first = results?.[0] as any;
console.log(`shape: ctor=${first?.constructor?.name} isSome=${first?.isSome} isEmpty=${first?.isEmpty} value=${first?.value ?? first?.inner ?? "?"} str=${String(first).slice(0, 80)}`);
for (let i = 0; i < (results?.length ?? 0); i++) {
  const opt = results[i] as any;
  // node runtime: Option codec with isSome; bun: may arrive bare or wrapped
  const hasIsSome = typeof opt?.isSome === "boolean";
  if (hasIsSome && !opt.isSome) continue;
  const raw = opt?.value ?? opt?.inner ?? opt;
  const bytes = raw?.toU8a ? raw.toU8a(true) : raw;
  if (!bytes || typeof bytes.length !== "number" || bytes.length < 32) continue;
  console.log(`uid=${i} ${encodeAddress(new Uint8Array(bytes), 42)}`);
}
process.exit(0);
