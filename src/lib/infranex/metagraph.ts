import { decodeAddress } from "@polkadot/util-crypto";
import { getChainApi } from "./chain";

/**
 * Metagraph access — per-UID state for a subnet, plus the miner's own UID.
 *
 * Chain storage reality (probed live, Sep 2026):
 *   - `Keys` is a DOUBLE MAP (netuid, uid) → AccountId32. There is NO reverse
 *     Hotkeys map. To find a hotkey's UID we batch-scan keys(netuid, uid)
 *     via `.multi()` (one state_queryStorageAt for ≤512 slots) and compare
 *     decoded AccountId bytes exactly.
 *   - Vector storages (Incentive, Consensus, Emission, Active, …) are
 *     Vec<u16>/Vec<u64> keyed by netuid. Names drift between spec versions —
 *     every read goes through tryRead() which probes candidate names.
 *   - A clean `null` from the key scan means NOT REGISTERED. A thrown error
 *     means infra trouble — callers must skip the pass rather than raise a
 *     false alarm.
 */

export interface UidVectors {
  /** Per-UID u16-normalized (0-1) values; index = uid. */
  active: boolean[];
  incentive: number[];
  consensus: number[];
  /** Raw emission per uid (rAO units as number) + relative-to-max normalized. */
  emissionRaw: number[];
  emissionRel: number[];
  validatorTrust: number[];
  /** Blocks since last update (larger = staler). */
  lastUpdateBlock: number[];
  registeredUids: number;
  blockNumber: number;
}

export interface SubnetHyperparams {
  tempo: number | null;
  immunityPeriod: number | null;
  maxAllowedUids: number | null;
}

export interface UidState {
  /** UID of the hotkey, or null when not registered on this subnet. */
  uid: number | null;
  /** Block at which this hotkey registered (immunity clock origin), or null
   *  when unregistered / the storage isn't exposed by the current runtime. */
  registrationBlock: number | null;
  vectors: UidVectors | null;
  hyperparams: SubnetHyperparams;
  /** Cohort stats among REWARDED uids. */
  cohort: {
    registeredUids: number;
    earningUids: number;
    /** Median incentive among earning (rewarded) uids, 0-1. */
    medianRewardedIncentive: number;
  };
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// Storage-name probing (spec drift protection)
// ---------------------------------------------------------------------------

type AnyApi = Awaited<ReturnType<typeof getChainApi>>;

const storageCache = new Map<string, string[]>();

function storageCandidates(api: AnyApi, ...names: string[]): string[] {
  const key = names.join("|");
  const cached = storageCache.get(key);
  if (cached) return cached;
  const available: string[] = [];
  try {
    const mod = api.query.subtensorModule as unknown as Record<string, unknown>;
    available.push(...names.filter((n) => typeof mod[n] !== "undefined"));
  } catch {
    available.push(...names);
  }
  storageCache.set(key, available);
  return available;
}

async function tryReadVec(
  api: AnyApi,
  netuid: number,
  names: string[]
): Promise<number[] | null> {
  for (const name of storageCandidates(api, ...names)) {
    try {
       
      const v = await (api.query.subtensorModule as any)[name](netuid);
      if (!v) continue;
      const arr = v.toArray ? v.toArray() : [];
      if (arr.length) return arr.map((x: { toString(): string }) => Number(x.toString()));
    } catch {
      continue;
    }
  }
  return null;
}

async function tryReadBoolVec(
  api: AnyApi,
  netuid: number,
  names: string[]
): Promise<boolean[] | null> {
  for (const name of storageCandidates(api, ...names)) {
    try {
       
      const v = await (api.query.subtensorModule as any)[name](netuid);
      if (!v) continue;
      const arr = v.toArray ? v.toArray() : [];
      if (arr.length) return arr.map((x: { isTrue: boolean }) => !!x.isTrue);
    } catch {
      continue;
    }
  }
  return null;
}

async function tryReadScalar(
  api: AnyApi,
  netuid: number,
  names: string[]
): Promise<number | null> {
  for (const name of storageCandidates(api, ...names)) {
    try {
       
      const v = await (api.query.subtensorModule as any)[name](netuid);
      if (v === null || v === undefined) continue;
      // Some are maps keyed by netuid, some plain — call with netuid first.
       
      const val = typeof (v as any).toNumber === "function" ? v : await v;
      return Number(val.toString());
    } catch {
      continue;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Key scan — find a hotkey's UID (DOUBLE MAP, no reverse index)
// ---------------------------------------------------------------------------

const UID_SCAN_CHUNK = 512;

async function findUidByHotkey(
  api: AnyApi,
  netuid: number,
  hotkey: string,
  registeredUids: number
): Promise<number | null> {
  let target: Uint8Array;
  try {
    target = decodeAddress(hotkey);
  } catch {
    throw new Error(`Invalid hotkey SS58: ${hotkey}`);
  }

  for (let start = 0; start < registeredUids; start += UID_SCAN_CHUNK) {
    const end = Math.min(start + UID_SCAN_CHUNK, registeredUids);
    const args: [number, number][] = [];
    for (let uid = start; uid < end; uid++) args.push([netuid, uid]);
    // One state_queryStorageAt round-trip for the whole chunk.
     
    const results = await (api.query.subtensorModule.keys as any).multi(args);
    for (let i = 0; i < results.length; i++) {
       
      // Shape varies by polkadot-js/runtime: some return Option<AccountId32>
      // (has .isSome), others auto-unwrap to a bare AccountId32 whose
      // .toString() IS the SS58. Handle both — this bug silently made every
      // hotkey "not registered" when .isSome was undefined.
      const opt = results[i] as any;
      if (!opt) continue;
      if (typeof opt.isSome === "boolean" && !opt.isSome) continue;
      const raw = opt.value !== undefined && opt.value?.toU8a ? opt.value : opt.inner ?? opt;
      const bytes = raw?.toU8a ? raw.toU8a() : raw;
      if (!bytes) continue;
      const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      // An auto-unwrapped None arrives as an empty/zero buffer — skip it.
      if (arr.length !== 32) continue;
      if (arr.every((b: number) => b === 0)) continue;
      if (bytesEqual(arr, target)) return start + i;
    }
  }
  return null;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Cache — 60s per netuid, shared across all callers
// ---------------------------------------------------------------------------

interface CacheEntry {
  vectors: UidVectors;
  hyperparams: SubnetHyperparams;
  fetchedAt: number;
}

const vectorCache = new Map<number, CacheEntry>();
const CACHE_TTL_MS = 60_000;

/** Normalize raw vectors into a UidVectors struct. */
function normalizeVectors(raw: {
  active: boolean[] | null;
  incentive: number[] | null;
  consensus: number[] | null;
  emission: number[] | null;
  validatorTrust: number[] | null;
  lastUpdate: number[] | null;
  registeredUids: number;
  blockNumber: number;
}): UidVectors {
  const n = raw.registeredUids;
  const scale = (arr: number[] | null) =>
    arr && n > 0 ? arr.slice(0, n).map((v) => v / 65535) : new Array(n).fill(0);
  const emissionRaw = raw.emission ? raw.emission.slice(0, n) : new Array(n).fill(0);
  const maxEmission = Math.max(1, ...emissionRaw);
  return {
    active: raw.active && n > 0 ? raw.active.slice(0, n) : new Array(n).fill(true),
    incentive: scale(raw.incentive),
    consensus: scale(raw.consensus),
    emissionRaw,
    emissionRel: emissionRaw.map((v) => v / maxEmission),
    validatorTrust: scale(raw.validatorTrust),
    lastUpdateBlock: raw.lastUpdate ? raw.lastUpdate.slice(0, n) : new Array(n).fill(0),
    registeredUids: n,
    blockNumber: raw.blockNumber,
  };
}

/**
 * Full per-UID state for a subnet. Throws on infra errors (caller decides
 * whether to skip); returns uid=null inside when the hotkey isn't registered.
 */
export async function getUidState(
  netuid: number,
  hotkey?: string | null
): Promise<UidState> {
  const api = await getChainApi();

  const [subnetworkN, blockNumber] = await Promise.all([
    tryReadScalar(api, netuid, ["subnetworkN", "SubnetworkN"]),
    api.rpc.chain.getHeader().then((h) => h.number.toNumber()),
  ]);
  const registeredUids = subnetworkN ?? 0;

  // Vector cache (60s) — the expensive part is the key scan, but vectors
  // change per tempo anyway.
  let entry = vectorCache.get(netuid);
  if (!entry || Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    const [active, incentive, consensus, emission, validatorTrust, lastUpdate] =
      await Promise.all([
        tryReadBoolVec(api, netuid, ["active", "Active", "IsActive"]),
        tryReadVec(api, netuid, ["incentive", "Incentive", "Incentives"]),
        tryReadVec(api, netuid, ["consensus", "Consensus", "Consensuses"]),
        tryReadVec(api, netuid, ["emission", "Emission", "Emissions"]),
        tryReadVec(api, netuid, ["validatorTrust", "ValidatorTrust", "PruningScores"]),
        tryReadVec(api, netuid, ["lastUpdate", "LastUpdate"]),
      ]);
    const hyperparams: SubnetHyperparams = {
      tempo: await tryReadScalar(api, netuid, ["tempo", "Tempo"]),
      immunityPeriod: await tryReadScalar(api, netuid, ["immunityPeriod", "ImmunityPeriod"]),
      maxAllowedUids: await tryReadScalar(api, netuid, ["maxAllowedUids", "MaxAllowedUids"]),
    };
    entry = {
      vectors: normalizeVectors({
        active,
        incentive,
        consensus,
        emission,
        validatorTrust,
        lastUpdate,
        registeredUids,
        blockNumber,
      }),
      hyperparams,
      fetchedAt: Date.now(),
    };
    vectorCache.set(netuid, entry);
  }

  const vectors = entry.vectors;

  // Locate the hotkey's UID (only when requested and plausibly registered).
  let uid: number | null = null;
  if (hotkey && registeredUids > 0) {
    uid = await findUidByHotkey(api, netuid, hotkey, registeredUids);
  }

  // Registration block → origin of the immunity window. Optional storage:
  // probe candidate names (spec drift) and stay null on ANY failure so the
  // wizard just shows the window length instead of a countdown.
  let registrationBlock: number | null = null;
  if (uid !== null) {
    const mod = api.query.subtensorModule as unknown as Record<string, unknown>;
    for (const name of ["blockAtRegistration", "BlockAtRegistration", "registrationBlock", "RegistrationBlock"]) {
      try {
        if (typeof mod[name] === "undefined") continue;
        const v = await (mod[name] as (a: number, b: number) => Promise<any>)(netuid, uid);
        const n = v && !v.isEmpty ? Number(v.toString()) : null;
        if (n !== null && Number.isFinite(n) && n > 0) {
          registrationBlock = n;
          break;
        }
      } catch {
        continue;
      }
    }
  }

  // Cohort stats among rewarded uids.
  const rewarded = vectors.incentive.filter((v) => v > 0.0005).sort((a, b) => a - b);
  const cohort = {
    registeredUids,
    earningUids: rewarded.length,
    medianRewardedIncentive: rewarded.length
      ? rewarded[Math.floor(rewarded.length / 2)]
      : 0,
  };

  return {
    uid,
    registrationBlock,
    vectors,
    hyperparams: entry.hyperparams,
    cohort,
    fetchedAt: entry.fetchedAt,
  };
}
