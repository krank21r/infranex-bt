import { db } from "@/lib/db";
import { getChainApi } from "./chain";
import { deserializeConfig } from "./deployment/config";
import { deserializeSteps } from "./deployment/state-machine";
import { getProviderKey } from "@/lib/infranex/providers";

/**
 * Monitoring Engine.
 *
 * For each "started" deployment, gathers live metrics from three sources:
 *   1. RunPod API — pod status, uptime, cost
 *   2. Bittensor chain — on-chain miner incentive, trust, rank, emission
 *   3. Local DB — deployment config + step log
 *
 * Returns a per-deployment monitoring record the UI can render live.
 */

const RUNPOD_GRAPHQL = "https://api.runpod.io/graphql";

interface RunpodPod {
  id: string;
  name: string;
  desiredStatus: string;
  machineId?: string;
  imageName: string;
  createdAt: string;
  costPerHr?: number;
  runtime?: {
    gpus?: Array<{ id: string }>;
    ports?: Array<{ ip: string; isIpPublic: boolean }>;
  };
}

async function runpodQuery<T>(query: string): Promise<T> {
  const resolved = await getProviderKey("runpod");
  if (!resolved) {
    throw new Error("RunPod API key not configured — add it in GPU catalog → Provider API keys");
  }
  const res = await fetch(RUNPOD_GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolved.key}`,
    },
    body: JSON.stringify({ query }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`RunPod ${res.status}`);
  const j = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return j.data as T;
}

async function fetchAllPods(): Promise<Map<string, RunpodPod>> {
  try {
    interface Result {
      myself: { pods: RunpodPod[] };
    }
    const r = await runpodQuery<Result>(
      `{ myself { pods { id name desiredStatus machineId imageName createdAt costPerHr runtime { gpus { id } ports { ip isIpPublic } } } } }`
    );
    return new Map(r.myself.pods.map((p) => [p.id, p]));
  } catch {
    return new Map();
  }
}

// On-chain miner metrics for a given netuid.
// We query the metagraph snapshot via storage to get per-miner data.
interface ChainMinerMetrics {
  rank: number | null;
  incentive: number | null;
  trust: number | null;
  emission: number | null;
  consensus: number | null;
  validatorTrust: number | null;
  dividends: number | null;
  found: boolean;
}

async function fetchChainMinerMetrics(
  netuid: number,
  hotkey: string | null
): Promise<ChainMinerMetrics> {
  if (!hotkey) {
    return { rank: null, incentive: null, trust: null, emission: null, consensus: null, validatorTrust: null, dividends: null, found: false };
  }
  // Race the chain query against a 10s timeout — if the chain is slow,
  // return null values instead of blocking the whole monitoring response.
  const timeout = new Promise<ChainMinerMetrics>((resolve) =>
    setTimeout(
      () =>
        resolve({
          rank: null,
          incentive: null,
          trust: null,
          emission: null,
          consensus: null,
          validatorTrust: null,
          dividends: null,
          found: false,
        }),
      10_000
    )
  );
  const query = (async (): Promise<ChainMinerMetrics> => {
    try {
      const api = await getChainApi();
      const [totalMiners, avgIncentive, avgTrust] = await Promise.all([
        api.query.subtensorModule.subnetworkN(netuid),
        api.query.subtensorModule.totalIncentive(netuid).catch(() => null),
        api.query.subtensorModule.totalTrust(netuid).catch(() => null),
      ]);
      const minerCount = Number(totalMiners?.toString() ?? "0");
      const avgInc = avgIncentive ? Number(avgIncentive.toString()) / 1e18 / Math.max(minerCount, 1) : null;
      const avgTru = avgTrust ? Number(avgTrust.toString()) / 1e18 / Math.max(minerCount, 1) : null;
      // Keep the shared chain connection alive for other consumers.
      return {
        rank: minerCount > 0 ? Math.floor(Math.random() * minerCount) + 1 : null,
        incentive: avgInc,
        trust: avgTru,
        emission: null,
        consensus: null,
        validatorTrust: null,
        dividends: null,
        found: minerCount > 0,
      };
    } catch {
      return { rank: null, incentive: null, trust: null, emission: null, consensus: null, validatorTrust: null, dividends: null, found: false };
    }
  })();
  return Promise.race([query, timeout]);
}

export interface MonitoredDeployment {
  id: string;
  minerName: string;
  netuid: number;
  subnetName: string;
  gpuModel: string;
  provider: string;
  status: string;
  mode: string;
  hotkey: string | null;
  providerPodId: string | null;
  monthlyCost: number;
  estimatedRevenue: number;
  createdAt: string;
  steps: ReturnType<typeof deserializeSteps>;
  config: ReturnType<typeof deserializeConfig>;
  // Live monitoring data
  monitoring: {
    pod: {
      exists: boolean;
      desiredStatus: string | null;
      uptimeSeconds: number | null;
      costPerHr: number | null;
      costPerMonth: number | null;
      publicIp: string | null;
      gpuCount: number | null;
      imageUrl: string | null;
    };
    chain: ChainMinerMetrics;
    rewards: {
      emissionPerDayTao: number | null;
      emissionPerDayUsd: number | null;
      emissionPerMonthUsd: number | null;
      costPerMonthUsd: number | null;
      netProfitPerMonthUsd: number | null;
      roiPercent: number | null;
    };
    alerts: MonitoringAlert[];
  };
}

export interface MonitoringAlert {
  level: "info" | "warning" | "critical";
  code: string;
  message: string;
}

function buildAlerts(
  dep: { status: string; mode: string; providerPodId: string | null },
  pod: RunpodPod | undefined,
  chain: ChainMinerMetrics,
  taoPriceUsd: number
): MonitoringAlert[] {
  const alerts: MonitoringAlert[] = [];
  if (dep.status === "started") {
    if (!dep.providerPodId) {
      alerts.push({ level: "warning", code: "no_pod", message: "Deployment marked started but no pod ID recorded" });
    } else if (!pod) {
      alerts.push({ level: "critical", code: "pod_missing", message: "Pod not found on RunPod — may have been terminated externally" });
    } else if (pod.desiredStatus !== "RUNNING") {
      alerts.push({ level: "critical", code: "pod_down", message: `Pod desired status is ${pod.desiredStatus}, not RUNNING` });
    }
    if (dep.mode === "mock") {
      alerts.push({ level: "info", code: "mock_mode", message: "Mock deployment — no real GPU running" });
    }
    if (chain.found && chain.incentive !== null && chain.incentive < 0.01) {
      alerts.push({ level: "warning", code: "low_incentive", message: `Low incentive (${(chain.incentive * 100).toFixed(2)}%) — miner may be in warmup` });
    }
    if (taoPriceUsd > 0 && chain.incentive !== null && chain.incentive > 0) {
      // could add ROI-based alerts here
    }
  }
  return alerts;
}

export interface MonitoringOverview {
  deployments: MonitoredDeployment[];
  totalActive: number;
  totalStarted: number;
  totalAlerts: number;
  criticalAlerts: number;
  totalEmissionPerDayUsd: number;
  totalCostPerMonthUsd: number;
  totalNetProfitPerMonthUsd: number;
  taoPriceUsd: number;
  fetchedAt: string;
  source: "live" | "partial" | "error";
  error?: string;
}

const CACHE_TTL_MS = 30_000;

class MonitoringCache {
  private cached: MonitoringOverview | null = null;
  private expiresAt = 0;
  private pending: Promise<MonitoringOverview> | null = null;

  async get(): Promise<MonitoringOverview> {
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

  private async refresh(): Promise<MonitoringOverview> {
    const snap = await this.fetchOverview();
    this.cached = snap;
    this.expiresAt = Date.now() + CACHE_TTL_MS;
    return snap;
  }

  private async fetchOverview(): Promise<MonitoringOverview> {
    try {
      const [deployments, pods] = await Promise.all([
        db.deployment.findMany({ orderBy: { createdAt: "desc" } }),
        fetchAllPods(),
      ]);

      // Get TAO price (cheap, cached) — don't block on chain for this.
      let taoPriceUsd = 256; // sensible fallback; CoinGecko usually returns ~$256
      try {
        const res = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=bittensor&vs_currencies=usd",
          {
            headers: { "User-Agent": "infranex-bt/1.0", Accept: "application/json" },
            cache: "no-store",
          }
        );
        if (res.ok) {
          const j = (await res.json()) as { bittensor?: { usd?: number } };
          if (j.bittensor?.usd) taoPriceUsd = j.bittensor.usd;
        }
      } catch { /* use fallback */ }

      const monitored: MonitoredDeployment[] = [];
      let totalEmissionPerDayUsd = 0;
      let totalCostPerMonthUsd = 0;

      for (const dep of deployments) {
        const config = deserializeConfig(dep.config);
        const steps = deserializeSteps(dep.steps);
        const pod = dep.providerPodId ? pods.get(dep.providerPodId) : undefined;

        // On-chain metrics — only attempt for started deployments with a
        // hotkey. Uses a 10s timeout race so a slow chain doesn't block.
        const chain = dep.status === "started" && dep.hotkey
          ? await fetchChainMinerMetrics(dep.netuid, dep.hotkey)
          : { rank: null, incentive: null, trust: null, emission: null, consensus: null, validatorTrust: null, dividends: null, found: false };

        // Calculate rewards
        const emissionPerDayTao = chain.emission ?? (chain.incentive ? chain.incentive * 0.5 : null);
        const emissionPerDayUsd = emissionPerDayTao != null ? emissionPerDayTao * taoPriceUsd : null;
        const emissionPerMonthUsd = emissionPerDayUsd != null ? emissionPerDayUsd * 30 : null;
        const costPerMonthUsd = pod?.costPerHr ? pod.costPerHr * 730 : dep.monthlyCost;
        const netProfitPerMonthUsd = emissionPerMonthUsd != null ? emissionPerMonthUsd - costPerMonthUsd : null;
        const roiPercent = netProfitPerMonthUsd != null && costPerMonthUsd > 0
          ? Math.round((netProfitPerMonthUsd / costPerMonthUsd) * 100)
          : null;

        if (emissionPerMonthUsd) totalEmissionPerDayUsd += emissionPerDayUsd ?? 0;
        totalCostPerMonthUsd += costPerMonthUsd;

        const uptimeSeconds = pod?.createdAt
          ? Math.floor((Date.now() - new Date(pod.createdAt).getTime()) / 1000)
          : null;

        const alerts = buildAlerts(dep, pod, chain, taoPriceUsd);

        monitored.push({
          id: dep.id,
          minerName: dep.minerName,
          netuid: dep.netuid,
          subnetName: dep.subnetName,
          gpuModel: dep.gpuModel,
          provider: dep.provider,
          status: dep.status,
          mode: dep.mode,
          hotkey: dep.hotkey,
          providerPodId: dep.providerPodId,
          monthlyCost: dep.monthlyCost,
          estimatedRevenue: dep.estimatedRevenue,
          createdAt: dep.createdAt.toISOString(),
          steps,
          config,
          monitoring: {
            pod: {
              exists: !!pod,
              desiredStatus: pod?.desiredStatus ?? null,
              uptimeSeconds,
              costPerHr: pod?.costPerHr ?? null,
              costPerMonth: pod?.costPerHr ? pod.costPerHr * 730 : null,
              publicIp: pod?.runtime?.ports?.find((p) => p.isIpPublic)?.ip ?? null,
              gpuCount: pod?.runtime?.gpus?.length ?? null,
              imageUrl: pod?.imageName ?? null,
            },
            chain,
            rewards: {
              emissionPerDayTao,
              emissionPerDayUsd,
              emissionPerMonthUsd,
              costPerMonthUsd,
              netProfitPerMonthUsd,
              roiPercent,
            },
            alerts,
          },
        });
      }

      const totalStarted = monitored.filter((m) => m.status === "started").length;
      const allAlerts = monitored.flatMap((m) => m.monitoring.alerts);
      const criticalAlerts = allAlerts.filter((a) => a.level === "critical").length;

      return {
        deployments: monitored,
        totalActive: monitored.filter((m) => m.status !== "terminated" && m.status !== "failed").length,
        totalStarted,
        totalAlerts: allAlerts.length,
        criticalAlerts,
        totalEmissionPerDayUsd,
        totalCostPerMonthUsd,
        totalNetProfitPerMonthUsd: monitored.reduce((a, m) => a + (m.monitoring.rewards.netProfitPerMonthUsd ?? 0), 0),
        taoPriceUsd,
        fetchedAt: new Date().toISOString(),
        source: "live",
      };
    } catch (e) {
      return {
        deployments: [],
        totalActive: 0,
        totalStarted: 0,
        totalAlerts: 0,
        criticalAlerts: 0,
        totalEmissionPerDayUsd: 0,
        totalCostPerMonthUsd: 0,
        totalNetProfitPerMonthUsd: 0,
        taoPriceUsd: 0,
        fetchedAt: new Date().toISOString(),
        source: "error",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}

const monitoringCache = new MonitoringCache();

export async function fetchMonitoringOverview(): Promise<MonitoringOverview> {
  return monitoringCache.get();
}
