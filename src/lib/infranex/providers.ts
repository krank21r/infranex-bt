// ---------------------------------------------------------------------------
// Provider API Keys — the server-side key vault + multi-provider offer engine.
//
// Users manage their GPU-marketplace API keys (RunPod, Vast.ai, Lambda Labs)
// from the GPU catalog UI. Keys are stored AES-256-GCM encrypted (same scheme
// as DevOps host secrets), never returned to the client (masked hint only),
// and used here to:
//   1. validate the key against the provider,
//   2. pull LIVE GPU offers into the catalog and the deploy wizard,
//   3. power real RunPod rentals + pod monitoring (getProviderKey replaces
//      the old process.env.RUNPOD_API_KEY reads everywhere).
//
// CLIENT-SAFETY: this module imports the db + crypto — server only. The
// client-safe primitives (normalizeModel, fetchRunpodGpus) live in runpod.ts
// and are imported from here, never the other way around.
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/devops/crypto";
import { fetchRunpodGpus, normalizeModel, type RunpodGpuType } from "./runpod";
import type { GPUOffer } from "./types";

// --- Provider registry ------------------------------------------------------

export type ProviderId = "runpod" | "vast" | "lambda" | "nvidia";

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  /** Live offer pull is implemented for this provider. */
  offers: boolean;
  /** Real rental adapter exists (wizard "RunPod (real)" mode). */
  rent: boolean;
  /** Where the user finds the key. */
  keyHint: string;
  note?: string;
}

export const PROVIDER_META: ProviderMeta[] = [
  {
    id: "runpod",
    label: "RunPod",
    offers: true,
    rent: true,
    keyHint: "runpod.io → Settings → API Keys → Create API Key",
    note: "Live pricing AND real rentals — the deploy wizard's RunPod (real) mode uses this key.",
  },
  {
    id: "vast",
    label: "Vast.ai",
    offers: true,
    rent: false,
    keyHint: "console.vast.ai → Account → Keys → copy API key",
    note: "Live market pricing. Rental adapter in progress — rent via RunPod (real) or simulated mode.",
  },
  {
    id: "lambda",
    label: "Lambda Labs",
    offers: true,
    rent: false,
    keyHint: "cloud.lambdalabs.com → API keys → Add API key",
    note: "Live on-demand pricing. Rental adapter in progress — rent via RunPod (real) or simulated mode.",
  },
  {
    id: "nvidia",
    label: "NVIDIA",
    offers: false,
    rent: false,
    keyHint: "No public self-serve marketplace API yet",
    note: "NVIDIA's H100/H200/B200 capacity appears through the other providers — their keys already cover it.",
  },
];

export function isProviderId(v: unknown): v is ProviderId {
  return typeof v === "string" && PROVIDER_META.some((p) => p.id === v);
}

// --- Key vault --------------------------------------------------------------

export interface ResolvedKey {
  key: string;
  origin: "db" | "env";
}

/**
 * Resolve a provider's API key: DB row (UI-managed, encrypted) first, then
 * the legacy env var for RunPod. Returns null when nothing is configured.
 */
export async function getProviderKey(providerId: ProviderId): Promise<ResolvedKey | null> {
  try {
    const row = await db.providerKey.findUnique({ where: { provider: providerId } });
    if (row?.keyEnc) {
      const key = decryptSecret(row.keyEnc);
      if (key) return { key, origin: "db" };
    }
  } catch {
    /* db unavailable — fall through to env */
  }
  if (providerId === "runpod" && process.env.RUNPOD_API_KEY) {
    return { key: process.env.RUNPOD_API_KEY, origin: "env" };
  }
  return null;
}

export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length <= 8) return "\u2022\u2022\u2022\u2022";
  return `${k.slice(0, 4)}\u2026${k.slice(-4)}`;
}

// --- Key validation ---------------------------------------------------------

export interface KeyCheck {
  ok: boolean;
  status: "valid" | "invalid" | "error";
  message: string;
}

const HTTP_TIMEOUT_MS = 10_000;

export async function validateProviderKey(providerId: ProviderId, key: string): Promise<KeyCheck> {
  try {
    if (providerId === "runpod") {
      const res = await fetch("https://api.runpod.io/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ query: "{ myself { id } }" }),
        cache: "no-store",
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, status: "invalid", message: "Key rejected by RunPod (401) — double-check the key." };
      }
      if (!res.ok) return { ok: false, status: "error", message: `RunPod API HTTP ${res.status}` };
      const j = (await res.json().catch(() => null)) as
        | { data?: { myself?: { id?: string } }; errors?: Array<{ message: string }> }
        | null;
      if (j?.errors?.length) return { ok: false, status: "invalid", message: j.errors[0].message };
      if (!j?.data?.myself?.id) {
        return { ok: false, status: "invalid", message: "Key accepted but no RunPod account came back — verify the key scope." };
      }
      return { ok: true, status: "valid", message: "Key valid — RunPod account verified." };
    }

    if (providerId === "vast") {
      const res = await fetch("https://console.vast.ai/api/v0/users/current/", {
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, status: "invalid", message: "Key rejected by Vast.ai (401) — double-check the key." };
      }
      if (!res.ok) return { ok: false, status: "error", message: `Vast.ai API HTTP ${res.status}` };
      const j = (await res.json().catch(() => null)) as { success?: boolean } | null;
      if (j && j.success === false) {
        return { ok: false, status: "invalid", message: "Key rejected by Vast.ai — double-check the key." };
      }
      return { ok: true, status: "valid", message: "Key valid — Vast.ai account verified." };
    }

    if (providerId === "lambda") {
      const res = await fetch("https://api.lambdalabs.com/api/v1/instance-types", {
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, status: "invalid", message: "Key rejected by Lambda (401) — double-check the key." };
      }
      if (!res.ok) return { ok: false, status: "error", message: `Lambda API HTTP ${res.status}` };
      const j = (await res.json().catch(() => null)) as
        | { data?: { instance_types?: unknown[] } }
        | null;
      const count = Array.isArray(j?.data?.instance_types) ? j!.data!.instance_types!.length : 0;
      return {
        ok: true,
        status: "valid",
        message: count > 0 ? `Key valid — ${count} Lambda instance types visible.` : "Key valid — Lambda returned no instance types yet.",
      };
    }

    return { ok: false, status: "error", message: "This provider has no API to validate against." };
  } catch (e) {
    return {
      ok: false,
      status: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

// --- Offer adapters ---------------------------------------------------------

export type LiveOffer = GPUOffer & { source: string };

const MONTHLY_HOURS = 730;

async function vastOffers(key: string): Promise<LiveOffer[]> {
  const q = encodeURIComponent(JSON.stringify({ rentable: { eq: true } }));
  const res = await fetch(`https://console.vast.ai/api/v0/bundles?q=${q}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Vast.ai HTTP ${res.status}`);
  // Vast has shipped two response shapes over the years — accept both.
  const j = (await res.json().catch(() => null)) as
    | { offers?: unknown[]; data?: { bundles?: unknown[]; offers?: unknown[] } }
    | null;
  const items: Record<string, unknown>[] =
    (j?.offers as Record<string, unknown>[]) ?? (j?.data?.bundles as Record<string, unknown>[]) ?? (j?.data?.offers as Record<string, unknown>[]) ?? [];

  const out: LiveOffer[] = [];
  for (const o of items) {
    const gpuName = String(o.gpu_name ?? "");
    const hourly = Number(o.dph_total ?? 0);
    const gpuRamMb = Number(o.gpu_ram ?? 0); // MB per GPU
    const numGpus = Number(o.num_gpus ?? 1);
    if (!gpuName || hourly <= 0 || gpuRamMb <= 0) continue;
    // Mining profile: whole single-GPU machines — multi-GPU bundles distort
    // the per-GPU price comparison in the wizard's VRAM filter.
    if (numGpus !== 1) continue;
    const vramGb = Math.round(gpuRamMb / 1024);
    const norm = normalizeModel(gpuName, vramGb);
    out.push({
      id: `vast-${String(o.id ?? `${gpuName}-${hourly}`)}`,
      model: norm?.model ?? gpuName,
      vramGb,
      provider: "Vast.ai",
      region: o.geolocation ? String(o.geolocation) : "global",
      hourlyPrice: Math.round(hourly * 1000) / 1000,
      monthlyPrice: Math.round(hourly * MONTHLY_HOURS),
      availability: "available",
      isSpot: Boolean(o.is_interruptible),
      ramGb: Math.round(Number(o.cpu_ram ?? 0) / 1024),
      cpuCores: Number(o.cpu_cores ?? 0),
      source: "vast",
    });
  }
  return out;
}

interface LambdaInstanceType {
  name?: string;
  price_cents_per_hour?: number;
  description?: string;
}

async function lambdaOffers(key: string): Promise<LiveOffer[]> {
  const res = await fetch("https://api.lambdalabs.com/api/v1/instance-types", {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Lambda HTTP ${res.status}`);
  const j = (await res.json().catch(() => null)) as
    | { data?: { instance_types?: LambdaInstanceType[] } }
    | null;
  const items = j?.data?.instance_types ?? [];

  const out: LiveOffer[] = [];
  for (const t of items) {
    const name = String(t.name ?? "");
    // Per-GPU offers only — gpu_8x_ bundles are cluster pricing.
    if (!name.startsWith("gpu_1x_")) continue;
    const cents = Number(t.price_cents_per_hour ?? NaN);
    if (!Number.isFinite(cents) || cents <= 0) continue;
    const desc = String(t.description ?? name);
    const vramMatch = desc.match(/(\d+)\s*GB/i);
    const vramGb = vramMatch ? Number(vramMatch[1]) : 0;
    if (!vramGb) continue;
    const gpuLabel = desc.replace(/^1x\s*/i, "").trim() || name;
    const norm = normalizeModel(gpuLabel, vramGb);
    const hourly = cents / 100;
    out.push({
      id: `lambda-${name}`,
      model: norm?.model ?? gpuLabel,
      vramGb,
      provider: "Lambda",
      region: "global",
      hourlyPrice: Math.round(hourly * 1000) / 1000,
      monthlyPrice: Math.round(hourly * MONTHLY_HOURS),
      availability: "available",
      isSpot: false,
      ramGb: 0,
      cpuCores: 0,
      source: "lambda",
    });
  }
  return out;
}

export async function fetchProviderOffers(providerId: ProviderId, key: string): Promise<LiveOffer[]> {
  if (providerId === "runpod") {
    const gpuTypes: RunpodGpuType[] = await fetchRunpodGpus(key);
    return normalizeRunpodGpuTypes(gpuTypes);
  }
  if (providerId === "vast") return vastOffers(key);
  if (providerId === "lambda") return lambdaOffers(key);
  return [];
}

function normalizeRunpodGpuTypes(gpuTypes: RunpodGpuType[]): LiveOffer[] {
  const out: LiveOffer[] = [];
  for (const g of gpuTypes) {
    const lp = g.lowestPrice;
    if (!lp) continue;
    const spot = lp.minimumBidPrice;
    const ondemand = lp.uninterruptablePrice;
    if (spot == null && ondemand == null) continue;
    const norm = normalizeModel(g.displayName, g.memoryInGb);
    if (!norm) continue; // skip consumer/irrelevant GPUs
    const hourlyPrice = ondemand ?? spot ?? 0;
    out.push({
      id: `runpod-${g.id}`,
      model: norm.model,
      vramGb: g.memoryInGb,
      provider: "RunPod",
      region: "global",
      hourlyPrice,
      monthlyPrice: Math.round(hourlyPrice * MONTHLY_HOURS),
      availability: spot != null && ondemand != null ? "available" : "limited",
      isSpot: spot != null && (ondemand == null || spot < ondemand),
      ramGb: 0,
      cpuCores: 0,
      source: "runpod",
    });
  }
  return out;
}

// --- Multi-provider snapshot (serves /api/gpu-offers) -----------------------

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  configured: boolean;
  origin?: "db" | "env";
  offers: number;
  error?: string;
}

export interface MultiProviderSnapshot {
  offers: LiveOffer[];
  source: "live" | "partial" | "error";
  fetchedAt: string;
  provider: string;
  totalGpuTypes: number;
  providers: ProviderStatus[];
}

const SNAPSHOT_TTL_MS = 60_000;

let cachedSnapshot: MultiProviderSnapshot | null = null;
let snapshotExpiresAt = 0;

/** Called whenever a key is added/updated/deleted so live offers refresh at once. */
export function invalidateProvidersCache(): void {
  cachedSnapshot = null;
  snapshotExpiresAt = 0;
}

/**
 * Pull LIVE offers from every configured provider in parallel. Providers
 * without keys are reported as not configured; failing providers are
 * reported with their error — the rest of the snapshot stays usable.
 */
export async function fetchAllLiveOffers(force = false): Promise<MultiProviderSnapshot> {
  const now = Date.now();
  if (!force && cachedSnapshot && now < snapshotExpiresAt) return cachedSnapshot;

  const liveProviders = PROVIDER_META.filter((p) => p.offers);
  const results = await Promise.all(
    liveProviders.map(async (p): Promise<{ status: ProviderStatus; offers: LiveOffer[] }> => {
      const resolved = await getProviderKey(p.id).catch(() => null);
      if (!resolved) {
        return { status: { id: p.id, label: p.label, configured: false, offers: 0 }, offers: [] };
      }
      try {
        const offers = await fetchProviderOffers(p.id, resolved.key);
        return {
          status: { id: p.id, label: p.label, configured: true, origin: resolved.origin, offers: offers.length },
          offers,
        };
      } catch (e) {
        return {
          status: {
            id: p.id,
            label: p.label,
            configured: true,
            origin: resolved.origin,
            offers: 0,
            error: e instanceof Error ? e.message : String(e),
          },
          offers: [],
        };
      }
    })
  );

  const offers = results
    .flatMap((r) => r.offers)
    .sort((a, b) => b.vramGb - a.vramGb || a.hourlyPrice - b.hourlyPrice);
  const configuredCount = results.filter((r) => r.status.configured).length;

  const snapshot: MultiProviderSnapshot = {
    offers,
    source: offers.length > 0 ? "live" : configuredCount > 0 ? "partial" : "error",
    fetchedAt: new Date().toISOString(),
    provider: offers.length > 0 ? (configuredCount > 1 ? "multi" : results.find((r) => r.status.offers > 0)?.status.label ?? "RunPod") : "RunPod",
    totalGpuTypes: offers.length,
    providers: results.map((r) => r.status),
  };

  cachedSnapshot = snapshot;
  snapshotExpiresAt = Date.now() + SNAPSHOT_TTL_MS;
  return snapshot;
}
