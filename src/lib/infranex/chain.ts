import { ApiPromise, HttpProvider } from "@polkadot/api";

/**
 * Singleton Bittensor Finney chain client.
 *
 * Connects over HTTP JSON-RPC (no WebSocket needed) to the public
 * entrypoint node. Reused across API route invocations to avoid the
 * ~3s cold-start metadata fetch on every request.
 */

const RPC_URL = "https://entrypoint-finney.opentensor.ai/rpc";

let _api: ApiPromise | null = null;
let _provider: HttpProvider | null = null;
let _connecting: Promise<ApiPromise> | null = null;

export async function getChainApi(): Promise<ApiPromise> {
  if (_api && _api.isConnected) return _api;
  if (_connecting) return _connecting;
  _connecting = (async () => {
    // Disconnect any stale connection before creating a fresh one.
    if (_api) {
      try { await _api.disconnect(); } catch { /* ignore */ }
      _api = null;
      _provider = null;
    }
    _provider = new HttpProvider(RPC_URL);
    _api = await ApiPromise.create({
      provider: _provider,
      noInitWarn: true,
      throwOnConnect: true,
    });
    return _api;
  })();
  try {
    return await _connecting;
  } finally {
    _connecting = null;
  }
}

/** Force a fresh connection on the next getChainApi() call. */
export async function recycleChainApi(): Promise<void> {
  if (_api) {
    try { await _api.disconnect(); } catch { /* ignore */ }
    _api = null;
    _provider = null;
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
  emission: number | null; // emission value per block
  owner: string | null;
  registeredAt: number | null;
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
      (n: number, uid: number) => Promise<{ toString(): string; isEmpty: boolean; toHuman?: () => unknown }>
    >;
    // Fetch neurons 0..limit-1
    const uids = Array.from({ length: Math.min(limit, 256) }, (_, i) => i);
    const results = await Promise.allSettled(
      uids.map(async (uid): Promise<NeuronMetrics | null> => {
        try {
          const [neuron, rank, emission, incentive, trust, consensus, validatorTrust, dividends] =
            await Promise.all([
              mods.neurons ? mods.neurons(netuid, uid) : Promise.resolve(null),
              mods.rank ? mods.rank(netuid, uid) : Promise.resolve(null),
              mods.emission ? mods.emission(netuid, uid) : Promise.resolve(null),
              mods.incentive ? mods.incentive(netuid, uid) : Promise.resolve(null),
              mods.trust ? mods.trust(netuid, uid) : Promise.resolve(null),
              mods.consensus ? mods.consensus(netuid, uid) : Promise.resolve(null),
              mods.validatorTrust ? mods.validatorTrust(netuid, uid) : Promise.resolve(null),
              mods.dividends ? mods.dividends(netuid, uid) : Promise.resolve(null),
            ]);
          // If rank is empty, this UID doesn't exist
          if (rank?.isEmpty) return null;
          return {
            uid,
            netuid,
            hotkey: "",
            coldkey: null,
            stake: toTao(neuron?.toString()),
            rank: toNumber(rank?.toString()),
            emission: toNumber(emission?.toString()),
            incentive: toNumber(incentive?.toString()),
            trust: toNumber(trust?.toString()),
            consensus: toNumber(consensus?.toString()),
            validatorTrust: toNumber(validatorTrust?.toString()),
            dividends: toNumber(dividends?.toString()),
            lastUpdate: 0,
            isActive: !rank?.isEmpty,
          } as NeuronMetrics & { netuid: number };
        } catch {
          return null;
        }
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) neurons.push(r.value as NeuronMetrics);
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
// In-memory snapshot cache. The chain read takes ~5s (16 subnets × multiple
// storage queries over HTTP JSON-RPC), so we cache the result for 30s and
// serve concurrent requests from memory. The client polls /api/network every
// 30s, so it almost always hits the cache.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 30_000;

class SnapshotCache {
  private cached: LiveNetworkSnapshot | null = null;
  private expiresAt = 0;
  private pending: Promise<LiveNetworkSnapshot> | null = null;

  async get(): Promise<LiveNetworkSnapshot> {
    const now = Date.now();
    if (this.cached && now < this.expiresAt) {
      return this.cached;
    }
    if (this.pending) {
      return this.pending;
    }
    this.pending = this.refresh();
    try {
      return await this.pending;
    } finally {
      this.pending = null;
    }
  }

  private async refresh(): Promise<LiveNetworkSnapshot> {
    const snap = await this.fetchFromChain();
    this.cached = snap;
    this.expiresAt = Date.now() + CACHE_TTL_MS;
    return snap;
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

      // Query in batches of 20 to avoid overwhelming the RPC node.
      for (let i = 0; i < allNetuids.length; i += 20) {
        const batch = allNetuids.slice(i, i + 20);
        const results = await Promise.allSettled(
          batch.map(async (n): Promise<LiveSubnetMetrics | null> => {
            const [miners, tao, alphaIn, alphaOut, tempo, emEnabled, priceRaw] =
              await Promise.all([
                mods.subnetworkN(n),
                mods.subnetTAO(n),
                mods.subnetAlphaIn(n),
                mods.subnetAlphaOut(n),
                mods.tempo(n),
                mods.subnetEmissionEnabled(n),
                mods.subnetMovingPrice(n),
              ]);
            const minerCount = Number(miners?.toString() ?? "0") || 0;
            const subnetTao = toTao(tao?.toString());
            if (minerCount === 0 && subnetTao === 0) return null;
            return {
              netuid: n,
              name: null,
              minersCount: minerCount,
              validatorsCount: null,
              subnetTao,
              alphaIn: toTao(alphaIn?.toString()),
              alphaOut: toTao(alphaOut?.toString()),
              tempo: Number(tempo?.toString() ?? "0") || 0,
              emissionEnabled: !emEnabled?.isEmpty,
              movingPrice: toTao(priceRaw?.toString()),
              emission: null,
              owner: null,
              registeredAt: null,
            };
          })
        );
        for (const r of results) {
          if (r.status === "fulfilled" && r.value) subnets.push(r.value);
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

      await recycleChainApi();

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
      try { await recycleChainApi(); } catch { /* ignore */ }
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
