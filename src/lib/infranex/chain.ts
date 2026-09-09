import { ApiPromise, WsProvider, HttpProvider } from "@polkadot/api";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Singleton Bittensor Finney chain client.
 *
 * Connects over WebSocket to the public entrypoint node (HTTP JSON-RPC
 * fallback), and reuses the connection across API route invocations.
 *
 * Bittensor's chain metadata is huge (~700KB), so it is persisted to disk
 * after the first successful connect and passed back to polkadot-js on
 * subsequent boots — cutting cold start from ~10-60s down to ~1-2s.
 */

const WS_URL = "wss://entrypoint-finney.opentensor.ai:443";
const RPC_URL = "https://entrypoint-finney.opentensor.ai/rpc";
const METADATA_FILE = path.join(process.cwd(), ".chain-metadata.json");

let _api: ApiPromise | null = null;
let _connecting: Promise<ApiPromise> | null = null;

function loadCachedMetadata(): Record<string, string> | null {
  try {
    if (existsSync(METADATA_FILE)) {
      return JSON.parse(readFileSync(METADATA_FILE, "utf8")) as Record<string, string>;
    }
  } catch {
    // corrupt file — ignore and fetch fresh
  }
  return null;
}

function saveMetadata(api: ApiPromise): void {
  try {
    const key = `${api.genesisHash.toHex()}-${api.runtimeVersion.specVersion}`;
    const existing = loadCachedMetadata() ?? {};
    if (existing[key]) return; // already cached for this runtime version
    existing[key] = api.runtimeMetadata.toHex();
    writeFileSync(METADATA_FILE, JSON.stringify(existing));
  } catch {
    // best-effort persistence
  }
}

async function createApi(): Promise<ApiPromise> {
  const metadata = loadCachedMetadata() as unknown as Record<string, `0x${string}`> | null;
  const createOpts = { noInitWarn: true, throwOnConnect: true, metadata: metadata ?? undefined };

  // WebSocket first — persistent connection, better for repeated reads.
  try {
    const provider = new WsProvider(WS_URL, 4000, undefined, 60_000);
    const api = await ApiPromise.create({ provider, ...createOpts });
    saveMetadata(api);
    return api;
  } catch {
    // fall through to HTTP
  }

  // HTTP JSON-RPC fallback.
  const provider = new HttpProvider(RPC_URL);
  const api = await ApiPromise.create({ provider, ...createOpts });
  saveMetadata(api);
  return api;
}

export async function getChainApi(): Promise<ApiPromise> {
  if (_api && _api.isConnected) return _api;
  if (_connecting) return _connecting;
  _connecting = (async () => {
    // Disconnect any stale connection before creating a fresh one.
    if (_api) {
      try { await _api.disconnect(); } catch { /* ignore */ }
      _api = null;
    }
    _api = await createApi();
    return _api;
  })();
  try {
    return await _connecting;
  } finally {
    _connecting = null;
  }
}

export interface LiveSubnetMetrics {
  netuid: number;
  name: string | null;
  minersCount: number;
  validatorsCount: number | null;
  subnetTao: number; // total TAO staked (raw units, 1e9 = 1 TAO)
  alphaIn: number;
  alphaOut: number;
  tempo: number;
  emissionEnabled: boolean;
  movingPrice: number; // alpha price in TAO raw units
  /** Whole-subnet emission value in TAO per block (alpha issued × alpha price). */
  emission: number | null;
  /** Whole-subnet emission value in TAO per day (per-block × 720). */
  emissionTaoPerDay: number | null;
  /** Emission flowing to miners (incentive uids) in TAO per day. */
  minerEmissionTaoPerDay: number | null;
  /** UIDs that earned incentive last epoch (actively rewarded miners). */
  rewardedMiners: number | null;
  /** Max allowed UIDs (registration capacity). */
  maxUids: number | null;
  owner: string | null;
  registeredAt: number | null;
  /** On-chain identity (SubnetIdentitiesV3) when registered. */
  identityGithub: string | null;
  identityDescription: string | null;
}

export interface NeuronMetrics {
  uid: number;
  netuid: number;
  hotkey: string;
  coldkey: string | null;
  stake: number;
  rank: number;
  emission: number;
  incentive: number;
  trust: number;
  consensus: number;
  validatorTrust: number;
  dividends: number;
  lastUpdate: number;
  isActive: boolean;
}

export interface LiveNetworkSnapshot {
  blockNumber: number;
  totalSubnets: number;
  specVersion: number;
  fetchedAt: string;
  taoPriceUsd: number;
  taoMarketCapUsd: number;
  taoChange24h: number;
  subnets: LiveSubnetMetrics[];
  neurons: NeuronMetrics[];
  source: "live" | "partial" | "error";
  error?: string;
}

// Curated netuids we track in detail (for curated names/descriptions).
const TRACKED_NETUIDS = [1, 2, 3, 4, 5, 7, 8, 9, 11, 12, 14, 17, 19, 21, 23, 25];

// Substrate TAO has 9 decimals.
const TAO_DECIMALS = 9;

function toTao(raw: unknown): number {
  const s = String(raw ?? "0").replace(/[^0-9]/g, "");
  const n = Number(s) / 10 ** TAO_DECIMALS;
  return Number.isFinite(n) ? n : 0;
}

function toNumber(raw: unknown): number {
  const s = String(raw ?? "0").replace(/[^0-9]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

async function fetchTaoPrice(): Promise<{
  usd: number;
  marketCap: number;
  change24h: number;
}> {
  // Try CoinGecko first (most reliable), then fall back to alternative sources.
  // CoinGecko rate-limits to ~10-30 req/min; if we get 429, we cache the last
  // good price and try a fallback API.

  // 1. CoinGecko
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bittensor&vs_currencies=usd&include_24hr_change=true&include_market_cap=true",
      {
        headers: {
          "User-Agent": "infranex-bt/1.0",
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      }
    );
    if (res.ok) {
      const j = (await res.json()) as {
        bittensor?: { usd?: number; usd_market_cap?: number; usd_24h_change?: number };
      };
      if (j.bittensor?.usd) {
        return {
          usd: j.bittensor.usd,
          marketCap: j.bittensor.usd_market_cap ?? 0,
          change24h: j.bittensor.usd_24h_change ?? 0,
        };
      }
    }
    // 429 or other error — fall through to fallback
  } catch {
    // timeout or network error — fall through to fallback
  }

  // 2. Fallback: Coinbase (no rate limit, different data path)
  try {
    const res = await fetch(
      "https://api.coinbase.com/v2/prices/TAO-USD/spot",
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      }
    );
    if (res.ok) {
      const j = (await res.json()) as {
        data?: { amount?: string };
      };
      const usd = parseFloat(j.data?.amount ?? "0");
      if (usd > 0) {
        return { usd, marketCap: 0, change24h: 0 };
      }
    }
  } catch {
    // fall through
  }

  // 3. Last resort: cached price (last known good value)
  if (lastKnownTaoPrice > 0) {
    return { usd: lastKnownTaoPrice, marketCap: 0, change24h: 0 };
  }

  return { usd: 0, marketCap: 0, change24h: 0 };
}

// Cache the last known good TAO price as a fallback when APIs are rate-limited.
let lastKnownTaoPrice = 0;

/**
 * Fetch neurons (individual miners) for a subnet via the metagraph.
 * Returns per-miner incentive, trust, rank, emission, stake, etc.
 * Limited to `limit` neurons to avoid heavy queries.
 */
async function fetchNeuronsForSubnet(
  api: Awaited<ReturnType<typeof getChainApi>>,
  netuid: number,
  limit: number
): Promise<NeuronMetrics[]> {
  const neurons: NeuronMetrics[] = [];
  try {
    const mods = api.query.subtensorModule as unknown as Record<
      string,
      (n: number) => Promise<{ toString(): string; isEmpty: boolean; toJSON?: () => unknown }>
    >;
    // Per-neuron data lives in per-SUBNET vector maps: each storage entry is
    // keyed by netuid and returns a Vec indexed by uid (length = max uids).
    // 7 single RPC calls per subnet instead of 7 × N per-neuron round-trips.
    const vec = async (
      map: ((n: number) => Promise<unknown>) | undefined,
      fallback: unknown[],
    ): Promise<unknown[]> => {
      if (!map) return fallback;
      try {
        const res = (await map(netuid)) as { toJSON?: () => unknown };
        return (res.toJSON?.() ?? fallback) as unknown[];
      } catch {
        return fallback;
      }
    };

    const [
      actives,
      incentives,
      consensuses,
      dividendsArr,
      emissions,
      lastUpdates,
      validatorTrusts,
    ] = await Promise.all([
      vec(mods.active, []),
      vec(mods.incentive, []),
      vec(mods.consensus, []),
      vec(mods.dividends, []),
      vec(mods.emission, []),
      vec(mods.lastUpdate, []),
      vec(mods.validatorTrust, []),
    ]);

    if (actives.length === 0) return neurons;
    const count = Math.min(actives.length, limit, 256);

    for (let i = 0; i < count; i++) {
      const isActive = actives[i] === true;
      const incentive = Number(incentives[i] ?? 0) || 0;
      const emission = Number(emissions[i] ?? 0) || 0;
      // Skip dormant uids that have never been active and hold no value.
      if (!isActive && incentive === 0 && emission === 0) continue;
      neurons.push({
        uid: i,
        netuid,
        hotkey: "",
        coldkey: null,
        stake: 0,
        rank: 0,
        emission,
        incentive,
        trust: 0,
        consensus: Number(consensuses[i] ?? 0) || 0,
        validatorTrust: Number(validatorTrusts[i] ?? 0) || 0,
        dividends: Number(dividendsArr[i] ?? 0) || 0,
        lastUpdate: Number(lastUpdates[i] ?? 0) || 0,
        isActive,
      } as NeuronMetrics & { netuid: number });
    }
  } catch {
    // best-effort
  }
  return neurons;
}

export async function fetchLiveSnapshot(): Promise<LiveNetworkSnapshot> {
  return snapshotCache.get();
}

// ---------------------------------------------------------------------------
// In-memory snapshot cache with stale-while-revalidate. The chain read batches
// all storage queries via .multi() (~40 RPC calls instead of ~2000), so a cold
// refresh takes ~2-5s. Results are cached for 60s; if the cache is expired but
// a stale snapshot exists, it is served IMMEDIATELY while a background refresh
// runs — so /api/network never hangs waiting on the chain.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000;
// Cold fetch now includes per-neuron emission vectors + identity registry
// (~15 batched RPC groups, ~20s measured) — give it headroom.
const CHAIN_FETCH_TIMEOUT_MS = 45_000;

class SnapshotCache {
  private cached: LiveNetworkSnapshot | null = null;
  private expiresAt = 0;
  private refreshing = false;
  private refreshPromise: Promise<LiveNetworkSnapshot> | null = null;

  async get(): Promise<LiveNetworkSnapshot> {
    const now = Date.now();
    if (this.cached && now < this.expiresAt) {
      return this.cached;
    }
    // Stale-but-present: return it now, refresh in the background.
    if (this.cached) {
      if (!this.refreshing) {
        this.refreshing = true;
        this.refreshPromise = this.refresh().finally(() => {
          this.refreshing = false;
          this.refreshPromise = null;
        });
      }
      return this.cached;
    }
    // No snapshot at all — single-flight the first fetch so concurrent
    // requests share one chain read instead of each spawning their own.
    if (!this.refreshPromise) {
      this.refreshing = true;
      this.refreshPromise = this.refresh().finally(() => {
        this.refreshing = false;
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async refresh(): Promise<LiveNetworkSnapshot> {
    try {
      const snap = await Promise.race([
        this.fetchFromChain(),
        new Promise<LiveNetworkSnapshot>((_, reject) =>
          setTimeout(() => reject(new Error("chain fetch timed out")), CHAIN_FETCH_TIMEOUT_MS)
        ),
      ]);
      this.cached = snap;
      this.expiresAt = Date.now() + CACHE_TTL_MS;
      return snap;
    } catch (e) {
      // Timed out or failed: keep serving any existing stale snapshot and
      // retry on the next poll instead of caching an error result.
      if (this.cached) return this.cached;
      return {
        blockNumber: 0,
        totalSubnets: 0,
        specVersion: 0,
        fetchedAt: new Date().toISOString(),
        taoPriceUsd: lastKnownTaoPrice,
        taoMarketCapUsd: 0,
        taoChange24h: 0,
        subnets: [],
        neurons: [],
        source: "error",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  private async fetchFromChain(): Promise<LiveNetworkSnapshot> {
    const price = await fetchTaoPrice();
    if (price.usd > 0) {
      lastKnownTaoPrice = price.usd;
    }
    try {
      const api = await getChainApi();
      const [header, totalNetworksRaw] = await Promise.all([
        api.rpc.chain.getHeader(),
        api.query.subtensorModule.totalNetworks(),
      ]);
      const totalSubnets = Number(totalNetworksRaw.toString()) || 0;
      const mods = api.query.subtensorModule as unknown as Record<
        string,
        (n: number) => Promise<{ toString(): string; isEmpty: boolean }>
      >;

      // Scan ALL subnets on chain (not just the 16 tracked ones).
      const allNetuids = Array.from({ length: Math.min(totalSubnets, 200) }, (_, i) => i);
      const subnets: LiveSubnetMetrics[] = [];

      // Batch queries: 7 .multi() RPC calls per batch of netuids instead of
      // 7 individual round-trips per subnet. Batches of 50 keep each request
      // payload reasonable while cutting total RPC calls from ~900 to ~20.
      const batchOf = 50;
      for (let i = 0; i < allNetuids.length; i += batchOf) {
        const batch = allNetuids.slice(i, i + batchOf);
        const multi = async (
          map: unknown,
        ): Promise<unknown[]> => {
          const m = map as { multi?: (keys: unknown[]) => Promise<unknown[]> } | undefined;
          if (!m?.multi) return batch.map(() => null);
          try {
            return (await m.multi(batch)) as unknown[];
          } catch {
            return batch.map(() => null);
          }
        };

        const [
          minersArr,
          taoArr,
          alphaInArr,
          alphaOutArr,
          tempoArr,
          emEnabledArr,
          priceArr,
        ] = await Promise.all([
          multi(mods.subnetworkN as never),
          multi(mods.subnetTAO as never),
          multi(mods.subnetAlphaIn as never),
          multi(mods.subnetAlphaOut as never),
          multi(mods.tempo as never),
          multi(mods.subnetEmissionEnabled as never),
          multi(mods.subnetMovingPrice as never),
        ]);

        // Real per-neuron emission data + subnet registry info for this
        // batch — 7 more batched .multi() calls instead of per-subnet
        // round-trips. The Emission vec holds per-uid alpha totals (rao)
        // for the last epoch; incentive/dividends split miners vs
        // validators. (The Active vec only flags validator weight
        // updates — verified on chain — so it is intentionally skipped.)
        const [
          emissionVecs,
          incentiveVecs,
          dividendsVecs,
          identitiesArr,
          ownerArr,
          registeredAtArr,
          maxUidsArr,
        ] = await Promise.all([
          multi(mods.emission as never),
          multi(mods.incentive as never),
          multi(mods.dividends as never),
          multi(mods.subnetIdentitiesV3 as never),
          multi(mods.subnetOwner as never),
          multi(mods.networkRegisteredAt as never),
          multi(mods.maxAllowedUids as never),
        ]);

        const numVec = (raw: unknown): number[] => {
          const v = (raw as { toJSON?: () => unknown } | null)?.toJSON?.();
          return Array.isArray(v) ? v.map((x) => Number(x) || 0) : [];
        };

        for (let j = 0; j < batch.length; j++) {
          const n = batch[j];
          try {
            const miners = minersArr[j] as { toString(): string } | null;
            const minerCount = Number(miners?.toString() ?? "0") || 0;
            const subnetTao = toTao((taoArr[j] as { toString(): string } | null)?.toString());
            if (minerCount === 0 && subnetTao === 0) continue;
            const emEnabled = emEnabledArr[j] as { isEmpty: boolean } | null;

            // --- Real emission accounting from per-neuron vectors ---
            const emVec = numVec(emissionVecs[j]);
            const incVec = numVec(incentiveVecs[j]);
            const divVec = numVec(dividendsVecs[j]);
            const tempoSafe = Math.max(
              Number((tempoArr[j] as { toString(): string } | null)?.toString() ?? "0") || 0,
              1
            );
            let epochAlphaRao = 0;
            let minerAlphaRao = 0;
            let rewardedMiners = 0;
            let validators = 0;
            const uidCount = Math.max(emVec.length, incVec.length);
            for (let u = 0; u < uidCount; u++) {
              const e = emVec[u] ?? 0;
              const inc = incVec[u] ?? 0;
              const div = divVec[u] ?? 0;
              if (e > 0) epochAlphaRao += e;
              if (inc > 0) { rewardedMiners++; minerAlphaRao += Math.max(e, 0); }
              if (div > 0) validators++;
            }
            // Per-uid values are last-epoch alpha totals → per-block = /tempo.
            const alphaPerBlock = epochAlphaRao / tempoSafe / 1e9; // α/block
            const movingPrice = toTao((priceArr[j] as { toString(): string } | null)?.toString());
            const alphaInTao = toTao((alphaInArr[j] as { toString(): string } | null)?.toString());
            // Alpha price: moving price when present, else pool ratio fallback.
            const priceTao =
              movingPrice > 0
                ? movingPrice
                : alphaInTao > 0 && subnetTao > 0
                  ? subnetTao / alphaInTao
                  : 0;
            // TAO-value emission for the whole subnet.
            const emissionPerBlockTao = alphaPerBlock * priceTao;
            const emissionPerDayTao = emissionPerBlockTao * 720;
            // Miner share of emission (miners vs validators split); 50/50 fallback.
            const validatorAlphaRao = Math.max(epochAlphaRao - minerAlphaRao, 0);
            const minerShare =
              minerAlphaRao + validatorAlphaRao > 0
                ? minerAlphaRao / (minerAlphaRao + validatorAlphaRao)
                : 0.5;

            // --- On-chain identity / owner / registration age ---
            const identityOpt = identitiesArr[j] as {
              isEmpty: boolean;
              unwrap?: () => {
                subnetName?: unknown;
                githubRepo?: unknown;
                description?: unknown;
              };
            } | null;
            // Identity fields are Vec<u8> — decode via toUtf8, hex fallback.
            const idText = (v: unknown): string => {
              if (v == null) return "";
              const codec = v as { toUtf8?: () => string };
              if (typeof codec.toUtf8 === "function") {
                try {
                  const s = codec.toUtf8().trim();
                  if (s && !s.startsWith("0x")) return s;
                } catch { /* fall through */ }
              }
              const s = typeof v === "string" ? v : String(v);
              if (s.startsWith("0x") && s.length > 2) {
                try {
                  const hex = s.slice(2);
                  const bytes = new Uint8Array(hex.length / 2);
                  for (let i = 0; i < bytes.length; i++) {
                    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
                  }
                  return new TextDecoder().decode(bytes).trim();
                } catch { return ""; }
              }
              return s.trim();
            };
            let idName = "";
            let idGithub = "";
            let idDesc = "";
            if (identityOpt && !identityOpt.isEmpty && identityOpt.unwrap) {
              try {
                const v = identityOpt.unwrap();
                idName = idText(v.subnetName);
                idGithub = idText(v.githubRepo);
                idDesc = idText(v.description);
              } catch {
                // identity unreadable — leave empty
              }
            }
            const ownerRaw = ownerArr[j] as
              | { toString(): string; isEmpty?: boolean }
              | null;
            const regBlock = Number(
              (registeredAtArr[j] as { toString(): string } | null)?.toString() ?? "0"
            ) || 0;
            const maxUids = Number(
              (maxUidsArr[j] as { toString(): string } | null)?.toString() ?? "0"
            ) || 0;

            subnets.push({
              netuid: n,
              name: idName || null,
              minersCount: minerCount,
              validatorsCount: validators || null,
              subnetTao,
              alphaIn: alphaInTao,
              alphaOut: toTao((alphaOutArr[j] as { toString(): string } | null)?.toString()),
              tempo: tempoSafe,
              emissionEnabled: !emEnabled?.isEmpty,
              movingPrice,
              emission: emissionPerBlockTao > 0 ? emissionPerBlockTao : null,
              emissionTaoPerDay: emissionPerDayTao > 0 ? emissionPerDayTao : null,
              minerEmissionTaoPerDay:
                emissionPerDayTao > 0 ? emissionPerDayTao * minerShare : null,
              rewardedMiners,
              maxUids: maxUids || null,
              owner: ownerRaw && !ownerRaw.isEmpty ? ownerRaw.toString() : null,
              registeredAt: regBlock || null,
              identityGithub: idGithub || null,
              identityDescription: idDesc || null,
            });
          } catch {
            // skip malformed entry
          }
        }
      }

      // Fetch neurons (metagraph data) for top 3 subnets by miner count.
      const topSubnets = [...subnets].sort((a, b) => b.minersCount - a.minersCount).slice(0, 3);
      const neurons: NeuronMetrics[] = [];
      for (const sub of topSubnets) {
        try {
          const subNeurons = await fetchNeuronsForSubnet(api, sub.netuid, Math.min(sub.minersCount, 50));
          neurons.push(...subNeurons);
        } catch {
          // skip
        }
      }

      // One runtime-API call for all 129 DynamicInfo records — gives the
      // REAL TAO pool per subnet (taoIn). The SubnetTAO storage value is
      // not the full staked pool, and requiredStake/APY math needs the
      // true figure.
      try {
        const dyn = (await api.call.subnetInfoRuntimeApi.getAllDynamicInfo()) as unknown as Array<{
          netuid: { toString(): string };
          taoIn: { toString(): string };
        }>;
        const taoInByNetuid = new Map<number, number>();
        for (const d of dyn) {
          try {
            const netuid = Number(d.netuid.toString());
            const taoIn = toTao(d.taoIn.toString());
            if (Number.isFinite(netuid) && taoIn > 0) taoInByNetuid.set(netuid, taoIn);
          } catch {
            // skip malformed entry
          }
        }
        for (const sub of subnets) {
          const taoIn = taoInByNetuid.get(sub.netuid);
          if (taoIn && taoIn > sub.subnetTao) sub.subnetTao = taoIn;
        }
      } catch {
        // DynamicInfo unavailable — keep storage values
      }

      // Keep the singleton connection alive — recycling it would force the
      // next refresh to re-fetch chain metadata (~3s cold start).

      return {
        blockNumber: header.number.toNumber(),
        totalSubnets,
        specVersion: api.runtimeVersion.specVersion.toNumber(),
        fetchedAt: new Date().toISOString(),
        taoPriceUsd: price.usd,
        taoMarketCapUsd: price.marketCap,
        taoChange24h: price.change24h,
        subnets,
        neurons,
        source: subnets.length > 0 ? "live" : "partial",
      };
    } catch (e) {
      return {
        blockNumber: 0,
        totalSubnets: 0,
        specVersion: 0,
        fetchedAt: new Date().toISOString(),
        taoPriceUsd: price.usd,
        taoMarketCapUsd: price.marketCap,
        taoChange24h: price.change24h,
        subnets: [],
        neurons: [],
        source: "error",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}

const snapshotCache = new SnapshotCache();
