import { gpuOffers as curatedOffers } from "./data";
import type { GPUOffer } from "./types";

/**
 * Live RunPod GPU pricing via their GraphQL API.
 *
 * Queries the authenticated `gpuTypes` endpoint for real-time spot
 * (minimumBidPrice) and on-demand (uninterruptablePrice) rates across
 * all 45+ GPU types they list. Cached for 60s — prices are relatively
 * stable and the API is rate-limited.
 */

const RUNPOD_GRAPHQL = "https://api.runpod.io/graphql";

interface RunpodPrice {
  minimumBidPrice: number | null;
  uninterruptablePrice: number | null;
}

interface RunpodGpuType {
  id: string;
  displayName: string;
  memoryInGb: number;
  lowestPrice: RunpodPrice | null;
}

interface LiveGpuOffer extends GPUOffer {
  live: true;
  source: "runpod";
}

export interface LiveGpuSnapshot {
  offers: LiveGpuOffer[];
  source: "live" | "partial" | "error";
  error?: string;
  fetchedAt: string;
  provider: "RunPod";
  totalGpuTypes: number;
}

// Map RunPod GPU names to our canonical model names + tiers.
function normalizeModel(displayName: string, vramGb: number): {
  model: string;
  tierLabel: "Entry" | "Mid" | "High" | "Flagship";
} | null {
  const n = displayName.toUpperCase();
  // Only include GPUs relevant to Bittensor mining (skip low-end/consumer).
  const map: { match: RegExp; model: string; tier: "Entry" | "Mid" | "High" | "Flagship" }[] = [
    { match: /^RTX 4090$/, model: "RTX 4090", tier: "High" },
    { match: /^RTX 4080/, model: "RTX 4080", tier: "Mid" },
    { match: /^RTX 3090 TI/, model: "RTX 3090 Ti", tier: "Mid" },
    { match: /^RTX 3090$/, model: "RTX 3090", tier: "Mid" },
    { match: /^RTX A5000$/, model: "RTX A5000", tier: "Mid" },
    { match: /^RTX A6000$/, model: "RTX A6000", tier: "High" },
    { match: /^RTX 6000 ADA/, model: "RTX 6000 Ada", tier: "High" },
    { match: /^RTX 5000 ADA/, model: "RTX 5000 Ada", tier: "Mid" },
    { match: /^A100 SXM 40GB/, model: "A100 40GB", tier: "High" },
    { match: /^A100 SXM$/, model: "A100 80GB", tier: "Flagship" },
    { match: /^A100 PCIE/, model: "A100 80GB PCIe", tier: "Flagship" },
    { match: /^A40$/, model: "A40", tier: "Mid" },
    { match: /^L40S$/, model: "L40S", tier: "High" },
    { match: /^L40$/, model: "L40", tier: "Mid" },
    { match: /^L4$/, model: "L4", tier: "Entry" },
    { match: /^H100 SXM$/, model: "H100 80GB", tier: "Flagship" },
    { match: /^H100 NVL$/, model: "H100 NVL", tier: "Flagship" },
    { match: /^H100 PCIE$/, model: "H100 PCIe", tier: "Flagship" },
    { match: /^H200 SXM$/, model: "H200 141GB", tier: "Flagship" },
    { match: /^H200 NVL$/, model: "H200 NVL", tier: "Flagship" },
    { match: /^B200$/, model: "B200 180GB", tier: "Flagship" },
    { match: /^B300/, model: "B300 288GB", tier: "Flagship" },
    { match: /^MI300X/, model: "MI300X 192GB", tier: "Flagship" },
    { match: /^RTX 5090$/, model: "RTX 5090", tier: "High" },
    { match: /^RTX 5080$/, model: "RTX 5080", tier: "Mid" },
  ];
  for (const m of map) {
    if (m.match.test(n)) {
      return { model: m.model, tierLabel: m.tier };
    }
  }
  return null;
}

async function fetchRunpodGpus(): Promise<RunpodGpuType[]> {
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!apiKey) throw new Error("RUNPOD_API_KEY not configured");

  const query = `{
    gpuTypes {
      id
      displayName
      memoryInGb
      lowestPrice {
        minimumBidPrice
        uninterruptablePrice
      }
    }
  }`;

  const res = await fetch(RUNPOD_GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query }),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`RunPod ${res.status} ${res.statusText}`);

  const j = (await res.json()) as {
    data?: { gpuTypes?: RunpodGpuType[] };
    errors?: Array<{ message: string }>;
  };

  if (j.errors?.length) throw new Error(j.errors[0].message);
  return j.data?.gpuTypes ?? [];
}

const CACHE_TTL_MS = 60_000;

class GpuSnapshotCache {
  private cached: LiveGpuSnapshot | null = null;
  private expiresAt = 0;
  private pending: Promise<LiveGpuSnapshot> | null = null;

  async get(): Promise<LiveGpuSnapshot> {
    const now = Date.now();
    if (this.cached && now < this.expiresAt) return this.cached;
    if (this.pending) return this.pending;
    this.pending = this.refresh();
    try {
      return await this.pending;
    } finally {
      this.pending = null;
    }
  }

  private async refresh(): Promise<LiveGpuSnapshot> {
    const snap = await this.fetchFromRunpod();
    this.cached = snap;
    this.expiresAt = Date.now() + CACHE_TTL_MS;
    return snap;
  }

  private async fetchFromRunpod(): Promise<LiveGpuSnapshot> {
    try {
      const gpuTypes = await fetchRunpodGpus();
      const offers: LiveGpuOffer[] = [];

      for (const g of gpuTypes) {
        const lp = g.lowestPrice;
        if (!lp) continue;
        const spot = lp.minimumBidPrice;
        const ondemand = lp.uninterruptablePrice;
        if (spot == null && ondemand == null) continue;

        const norm = normalizeModel(g.displayName, g.memoryInGb);
        if (!norm) continue; // skip consumer/irrelevant GPUs

        const hourlyPrice = ondemand ?? spot ?? 0;
        const monthlyPrice = Math.round(hourlyPrice * 730); // ~730 hrs/month

        offers.push({
          id: `runpod-${g.id}`,
          model: norm.model,
          vramGb: g.memoryInGb,
          provider: "RunPod",
          region: "global", // RunPod aggregates across regions
          hourlyPrice,
          monthlyPrice,
          availability: spot != null && ondemand != null ? "available" : "limited",
          isSpot: spot != null && (ondemand == null || spot < ondemand),
          ramGb: 0, // not exposed by this query
          cpuCores: 0,
          live: true,
          source: "runpod",
        });
      }

      offers.sort((a, b) => b.vramGb - a.vramGb);

      return {
        offers,
        source: offers.length > 0 ? "live" : "partial",
        fetchedAt: new Date().toISOString(),
        provider: "RunPod",
        totalGpuTypes: gpuTypes.length,
      };
    } catch (e) {
      return {
        offers: [],
        source: "error",
        error: e instanceof Error ? e.message : String(e),
        fetchedAt: new Date().toISOString(),
        provider: "RunPod",
        totalGpuTypes: 0,
      };
    }
  }
}

const gpuCache = new GpuSnapshotCache();

export async function fetchLiveGpuOffers(): Promise<LiveGpuSnapshot> {
  return gpuCache.get();
}

/**
 * Merge live RunPod offers with the curated catalog. Live RunPod prices
 * replace any curated RunPod entry; other providers (Vast.ai, TensorDock,
 * Lambda, E2E) remain "indicative" static values.
 */
export function mergeGpuOffers(snap: LiveGpuSnapshot | undefined): Array<
  GPUOffer & { live?: boolean; source?: string }
> {
  if (!snap || snap.offers.length === 0) {
    return curatedOffers.map((o) => ({
      ...o,
      live: false,
      source: o.provider === "RunPod" ? "static" : "indicative",
    }));
  }
  const liveByModel = new Map(snap.offers.map((o) => [`${o.provider}-${o.model}`, o]));
  const result: Array<GPUOffer & { live?: boolean; source?: string }> = [];
  // Add all live RunPod offers first
  for (const o of snap.offers) {
    result.push({ ...o, live: true, source: "runpod" });
  }
  // Then curated offers from other providers (skip curated RunPod, replaced by live)
  for (const o of curatedOffers) {
    if (o.provider === "RunPod") continue; // replaced by live
    result.push({ ...o, live: false, source: "indicative" });
  }
  return result.sort((a, b) => b.vramGb - a.vramGb);
}
