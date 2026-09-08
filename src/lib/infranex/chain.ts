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

export interface LiveSubnetMetrics {
  netuid: number;
  minersCount: number;
  validatorsCount: number | null;
  subnetTao: number; // total TAO staked (raw units, 1e9 = 1 TAO)
  alphaIn: number;
  alphaOut: number;
  tempo: number;
  emissionEnabled: boolean;
  movingPrice: number; // alpha price in TAO raw units
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
  source: "live" | "partial" | "error";
  error?: string;
}

const TRACKED_NETUIDS = [1, 2, 3, 4, 5, 7, 8, 9, 11, 12, 14, 17, 19, 21, 23, 25];

// Substrate TAO has 9 decimals.
const TAO_DECIMALS = 9;

function toTao(raw: unknown): number {
  // raw may be a BN-like or number; coerce to string then divide.
  const s = String(raw ?? "0").replace(/[^0-9]/g, "");
  const n = Number(s) / 10 ** TAO_DECIMALS;
  return Number.isFinite(n) ? n : 0;
}

async function fetchTaoPrice(): Promise<{
  usd: number;
  marketCap: number;
  change24h: number;
}> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bittensor&vs_currencies=usd&include_24hr_change=true&include_market_cap=true",
      {
        headers: {
          "User-Agent": "infranex-bt/1.0 (bittensor-intelligence-platform)",
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const j = (await res.json()) as {
      bittensor?: { usd?: number; usd_market_cap?: number; usd_24h_change?: number };
    };
    return {
      usd: j.bittensor?.usd ?? 0,
      marketCap: j.bittensor?.usd_market_cap ?? 0,
      change24h: j.bittensor?.usd_24h_change ?? 0,
    };
  } catch {
    return { usd: 0, marketCap: 0, change24h: 0 };
  }
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
    try {
      const api = await getChainApi();
      const [header, totalNetworks] = await Promise.all([
        api.rpc.chain.getHeader(),
        api.query.subtensorModule.totalNetworks(),
      ]);
      const mods = api.query.subtensorModule as unknown as Record<
        string,
        (n: number) => Promise<{ toString(): string; isEmpty: boolean }>
      >;

      const subnets: LiveSubnetMetrics[] = [];
      // Query all subnets concurrently for speed.
      const results = await Promise.allSettled(
        TRACKED_NETUIDS.map(async (n) => {
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
          const live: LiveSubnetMetrics = {
            netuid: n,
            minersCount: Number(miners?.toString() ?? "0") || 0,
            validatorsCount: null,
            subnetTao: toTao(tao?.toString()),
            alphaIn: toTao(alphaIn?.toString()),
            alphaOut: toTao(alphaOut?.toString()),
            tempo: Number(tempo?.toString() ?? "0") || 0,
            emissionEnabled: !emEnabled?.isEmpty,
            movingPrice: toTao(priceRaw?.toString()),
          };
          return live;
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled") subnets.push(r.value);
      }

      return {
        blockNumber: header.number.toNumber(),
        totalSubnets: Number(totalNetworks.toString()) || 0,
        specVersion: api.runtimeVersion.specVersion.toNumber(),
        fetchedAt: new Date().toISOString(),
        taoPriceUsd: price.usd,
        taoMarketCapUsd: price.marketCap,
        taoChange24h: price.change24h,
        subnets,
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
        source: "error",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}

const snapshotCache = new SnapshotCache();
