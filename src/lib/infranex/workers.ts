import { db } from "@/lib/db";
import { fetchLiveSnapshot } from "./chain";
import type { LiveNetworkSnapshot } from "./chain";
import { scrapeGithubMetadata } from "./github-scraper";
import { subnets } from "./data";
import { runTriggerPass } from "./triggers";
import { runUidDefensePass } from "./uid-defense";
import { runDevopsPass } from "./devops-monitor";
import { runMinerMindsetPass } from "./miner-mindset";
import { runServiceHealthPass } from "./service-health";
import { runAutopilotPass } from "./autopilot";
import { runUpstreamPass } from "./upstream";
import { runBenchmarkPass } from "./benchmarks";
import { runRunwayPass } from "./runway";
import { runAlertsDigestPass } from "./alerts";

/**
 * Background worker system.
 *
 * Four workers run on intervals to keep data fresh independently of
 * user requests:
 *
 *   1. Chain scanner worker  — polls the Finney chain every 2 min
 *   2. Market data worker    — fetches TAO price every 1 min
 *   3. GitHub analyzer worker — re-scrapes subnet repos every 60 min
 *   4. DevOps monitor worker — DEVOPS-1: runs the full trigger pass
 *      (RE_SYNC/SCALE/KILL + UID defense) + the DevOps pass (GPU health
 *      + subnet drift) + the Miner Mindset strategy pass (arbitrage,
 *      runtime optimization) every 90s, so deployed miners are watched
 *      continuously — no UI needs to be open.
 *
 * Each worker persists its results to the DB (ChainSnapshot, WorkerStatus,
 * TriggerEvent, GpuSample) so the frontend can read historical data and
 * show worker status.
 */

export interface WorkerRunResult {
  workerName: string;
  status: "completed" | "failed";
  durationMs: number;
  tasksProcessed: number;
  error?: string;
}

const INTERVALS = {
  chain: 2 * 60 * 1000,    // 2 minutes
  market: 60 * 1000,        // 1 minute
  github: 60 * 60 * 1000,  // 60 minutes
  devops: 90 * 1000,        // 90 seconds — DEVOPS-1 continuous monitor
  // TIER3 — upstream watcher (git intelligence): release/commit tracking.
  upstream: 30 * 60 * 1000, // 30 minutes
  // TIER3 — benchmark harness: periodic axon-latency runs per deployment.
  benchmarks: 10 * 60 * 1000, // 10 minutes
  // TIER4 — external alerting digest: hourly fleet summary to digest-enabled
  // webhook channels (event alerts themselves are dispatched at commit time).
  digest: 60 * 60 * 1000, // 60 minutes
};

// Track whether workers are running (singleton)
let workersStarted = false;
const workerTimers: NodeJS.Timeout[] = [];

/** Start all background workers (idempotent — only starts once). */
export function startWorkers() {
  if (workersStarted) return;
  workersStarted = true;

  // Run immediately, then on intervals
  void runChainWorker();
  void runMarketWorker();
  void runGithubWorker();
  void runDevopsWorker();
  void runUpstreamWorker();
  void runBenchmarkWorker();
  void runDigestWorker();

  workerTimers.push(setInterval(() => void runChainWorker(), INTERVALS.chain));
  workerTimers.push(setInterval(() => void runMarketWorker(), INTERVALS.market));
  workerTimers.push(setInterval(() => void runGithubWorker(), INTERVALS.github));
  workerTimers.push(setInterval(() => void runDevopsWorker(), INTERVALS.devops));
  workerTimers.push(setInterval(() => void runUpstreamWorker(), INTERVALS.upstream));
  workerTimers.push(setInterval(() => void runBenchmarkWorker(), INTERVALS.benchmarks));
  workerTimers.push(setInterval(() => void runDigestWorker(), INTERVALS.digest));
}

/** Get the status of all workers from the DB. */
export async function getWorkerStatuses() {
  const recent = await db.workerStatus.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  // Get the latest status per worker
  const byWorker = new Map<string, typeof recent[number]>();
  for (const w of recent) {
    if (!byWorker.has(w.workerName)) {
      byWorker.set(w.workerName, w);
    }
  }
  return Array.from(byWorker.values());
}

/** Get the most recent chain snapshot from the DB. */
export async function getLatestChainSnapshot(): Promise<LiveNetworkSnapshot | null> {
  const row = await db.chainSnapshot.findFirst({
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  return {
    blockNumber: row.blockNumber,
    totalSubnets: row.totalSubnets,
    specVersion: 0,
    fetchedAt: row.createdAt.toISOString(),
    taoPriceUsd: row.taoPriceUsd,
    taoMarketCapUsd: row.taoMarketCapUsd,
    taoChange24h: row.taoChange24h,
    subnets: JSON.parse(row.subnetsJson),
    neurons: JSON.parse(row.neuronsJson || "[]"),
    source: row.source as "live" | "partial" | "error",
  };
}

// --- Individual workers ---

/**
 * DEVOPS-1 — the continuous monitor. One pass = trigger evaluators
 * (pod-down, loss) + UID defense (deregistration risk) + DevOps evaluators
 * (GPU health, subnet drift) + the DEVOPS-4 service-health pass (synthetic
 * axon probe + validator traffic) + the DEVOPS-3 Miner Mindset strategy pass
 * (subnet arbitrage / compute recycling, runtime optimization). Sequential,
 * not parallel: they share the one chain connection and the 60s metagraph
 * vector cache.
 */
async function runDevopsWorker(): Promise<WorkerRunResult> {
  const start = Date.now();
  const workerName = "devops-monitor";
  let tasksProcessed = 0;
  try {
    const devops = await runDevopsPass({ accrueSpend: true });
    await runTriggerPass();
    await runUidDefensePass();
    try {
      await runServiceHealthPass();
    } catch (e) {
      // Service layer must never take the whole worker down.
      console.warn(`[devops-worker] service-health pass skipped: ${e instanceof Error ? e.message : e}`);
    }
    try {
      await runMinerMindsetPass();
    } catch (e) {
      // Strategy layer must never take the whole worker down.
      console.warn(`[devops-worker] mindset pass skipped: ${e instanceof Error ? e.message : e}`);
    }
    // TIER3 — autopilot: auto-approve + execute OPEN events that match an
    // enabled policy rule (denylist + scope + rate limit enforced inside).
    try {
      await runAutopilotPass();
    } catch (e) {
      // Policy layer must never take the whole worker down.
      console.warn(`[devops-worker] autopilot pass skipped: ${e instanceof Error ? e.message : e}`);
    }
    // TIER4 / RUNWAY-1 — immunity runway: computes the eviction T-minus from
    // the fresh UID-defense samples + live chain state (60s vector cache),
    // warns BEFORE the window closes. Must never take the worker down.
    try {
      await runRunwayPass();
    } catch (e) {
      console.warn(`[devops-worker] runway pass skipped: ${e instanceof Error ? e.message : e}`);
    }
    tasksProcessed = devops.deploymentsEvaluated;
    const result: WorkerRunResult = {
      workerName,
      status: "completed",
      durationMs: Date.now() - start,
      tasksProcessed,
    };
    await logWorkerRun(result);
    return result;
  } catch (e) {
    const result: WorkerRunResult = {
      workerName,
      status: "failed",
      durationMs: Date.now() - start,
      tasksProcessed,
      error: e instanceof Error ? e.message : String(e),
    };
    await logWorkerRun(result);
    return result;
  }
}

/**
 * TIER3 — upstream watcher (git intelligence). Tracks the latest release
 * tag + commit SHA per deployed subnet's repo; first sighting adopts the
 * baseline, repo movement commits UPSTREAM_DRIFT trigger events.
 */
export async function runUpstreamWorker(): Promise<WorkerRunResult> {
  const start = Date.now();
  const workerName = "upstream-watcher";
  let tasksProcessed = 0;
  try {
    const r = await runUpstreamPass();
    tasksProcessed = r.watched;
    const result: WorkerRunResult = {
      workerName,
      status: "completed",
      durationMs: Date.now() - start,
      tasksProcessed,
    };
    await logWorkerRun(result);
    return result;
  } catch (e) {
    const result: WorkerRunResult = {
      workerName,
      status: "failed",
      durationMs: Date.now() - start,
      tasksProcessed,
      error: e instanceof Error ? e.message : String(e),
    };
    await logWorkerRun(result);
    return result;
  }
}

/**
 * TIER3 — benchmark harness. Periodic multi-sample axon-latency runs per
 * started deployment; regressions vs the rolling baseline commit
 * BENCH_REGRESS trigger events (mocks never alarm).
 */
export async function runBenchmarkWorker(): Promise<WorkerRunResult> {
  const start = Date.now();
  const workerName = "benchmark-runner";
  let tasksProcessed = 0;
  try {
    const r = await runBenchmarkPass();
    tasksProcessed = r.ran;
    const result: WorkerRunResult = {
      workerName,
      status: "completed",
      durationMs: Date.now() - start,
      tasksProcessed,
    };
    await logWorkerRun(result);
    return result;
  } catch (e) {
    const result: WorkerRunResult = {
      workerName,
      status: "failed",
      durationMs: Date.now() - start,
      tasksProcessed,
      error: e instanceof Error ? e.message : String(e),
    };
    await logWorkerRun(result);
    return result;
  }
}

/**
 * TIER4 — external alerting digest worker. Hourly fleet summary posted to
 * digest-enabled webhook channels; per-event alerts fire at commitFinding
 * time instead (event-driven, not polled).
 */
export async function runDigestWorker(): Promise<WorkerRunResult> {
  const start = Date.now();
  const workerName = "alerts-digest";
  try {
    const r = await runAlertsDigestPass();
    const result: WorkerRunResult = {
      workerName,
      status: "completed",
      durationMs: Date.now() - start,
      tasksProcessed: r.sent + r.failed,
    };
    await logWorkerRun(result);
    return result;
  } catch (e) {
    const result: WorkerRunResult = {
      workerName,
      status: "failed",
      durationMs: Date.now() - start,
      tasksProcessed: 0,
      error: e instanceof Error ? e.message : String(e),
    };
    await logWorkerRun(result);
    return result;
  }
}

async function runChainWorker(): Promise<WorkerRunResult> {
  const start = Date.now();
  const workerName = "chain-scanner";
  try {
    const snap = await fetchLiveSnapshot();
    // Persist to DB
    await db.chainSnapshot.create({
      data: {
        blockNumber: snap.blockNumber,
        totalSubnets: snap.totalSubnets,
        scannedSubnets: snap.subnets.length,
        neuronCount: snap.neurons.length,
        taoPriceUsd: snap.taoPriceUsd,
        taoMarketCapUsd: snap.taoMarketCapUsd,
        taoChange24h: snap.taoChange24h,
        subnetsJson: JSON.stringify(snap.subnets),
        neuronsJson: JSON.stringify(snap.neurons),
        source: snap.source,
      },
    });
    // Prune old snapshots (keep last 100)
    const count = await db.chainSnapshot.count();
    if (count > 100) {
      const old = await db.chainSnapshot.findMany({
        orderBy: { createdAt: "desc" },
        skip: 100,
        select: { id: true },
      });
      if (old.length > 0) {
        await db.chainSnapshot.deleteMany({
          where: { id: { in: old.map((o) => o.id) } },
        });
      }
    }
    const result: WorkerRunResult = {
      workerName,
      status: "completed",
      durationMs: Date.now() - start,
      tasksProcessed: snap.subnets.length,
    };
    await logWorkerRun(result);
    return result;
  } catch (e) {
    const result: WorkerRunResult = {
      workerName,
      status: "failed",
      durationMs: Date.now() - start,
      tasksProcessed: 0,
      error: e instanceof Error ? e.message : String(e),
    };
    await logWorkerRun(result);
    return result;
  }
}

async function runMarketWorker(): Promise<WorkerRunResult> {
  const start = Date.now();
  const workerName = "market-data";
  try {
    // The chain worker already fetches TAO price, so this is a lightweight
    // check that just confirms the price is fresh (within 2 min).
    const snap = await getLatestChainSnapshot();
    const tasksProcessed = snap && snap.taoPriceUsd > 0 ? 1 : 0;
    const result: WorkerRunResult = {
      workerName,
      status: "completed",
      durationMs: Date.now() - start,
      tasksProcessed,
    };
    await logWorkerRun(result);
    return result;
  } catch (e) {
    const result: WorkerRunResult = {
      workerName,
      status: "failed",
      durationMs: Date.now() - start,
      tasksProcessed: 0,
      error: e instanceof Error ? e.message : String(e),
    };
    await logWorkerRun(result);
    return result;
  }
}

async function runGithubWorker(): Promise<WorkerRunResult> {
  const start = Date.now();
  const workerName = "github-analyzer";
  let tasksProcessed = 0;
  try {
    const toScrape = subnets.filter((s) => s.githubUrl);
    for (const subnet of toScrape) {
      try {
        const scraped = await scrapeGithubMetadata(subnet.githubUrl!);
        if (scraped.source === "github") {
          await db.subnetOverride.upsert({
            where: { netuid: subnet.netuid },
            create: {
              netuid: subnet.netuid,
              description: scraped.description,
              minVramGb: scraped.minVramGb,
              recommendedGpu: scraped.recommendedGpu,
              githubUrl: subnet.githubUrl,
            },
            update: {
              description: scraped.description ?? undefined,
              minVramGb: scraped.minVramGb ?? undefined,
              recommendedGpu: scraped.recommendedGpu ?? undefined,
              githubUrl: subnet.githubUrl,
            },
          });
          tasksProcessed++;
        }
      } catch {
        // skip individual failures
      }
    }
    const result: WorkerRunResult = {
      workerName,
      status: "completed",
      durationMs: Date.now() - start,
      tasksProcessed,
    };
    await logWorkerRun(result);
    return result;
  } catch (e) {
    const result: WorkerRunResult = {
      workerName,
      status: "failed",
      durationMs: Date.now() - start,
      tasksProcessed,
      error: e instanceof Error ? e.message : String(e),
    };
    await logWorkerRun(result);
    return result;
  }
}

async function logWorkerRun(result: WorkerRunResult) {
  try {
    await db.workerStatus.create({
      data: {
        workerName: result.workerName,
        status: result.status,
        lastRun: new Date(),
        durationMs: result.durationMs,
        tasksProcessed: result.tasksProcessed,
        error: result.error,
      },
    });
    // Prune old worker status logs (keep last 50 per worker)
    const count = await db.workerStatus.count({
      where: { workerName: result.workerName },
    });
    if (count > 50) {
      const old = await db.workerStatus.findMany({
        where: { workerName: result.workerName },
        orderBy: { createdAt: "desc" },
        skip: 50,
        select: { id: true },
      });
      if (old.length > 0) {
        await db.workerStatus.deleteMany({
          where: { id: { in: old.map((o) => o.id) } },
        });
      }
    }
  } catch {
    // best-effort logging
  }
}
