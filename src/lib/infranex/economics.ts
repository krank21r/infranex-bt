import { db } from "@/lib/db";

// WALLET-ECON-1 — real spend & earnings rollups.
//
//   SpendLedger   — accrues provider cost per UTC day while a deployment is
//                   started. Only WORKER-SCHEDULED passes accrue (the 90s
//                   cadence is the clock); manual trigger runs do not, so a
//                   human hammering "run" can't inflate the ledger.
//   EarningsDaily — accumulates per-UID emission deltas (rAO → TAO) from the
//                   UID-defense chain samples. The UidSnapshot table is a
//                   ~120-row rolling window (~6h); this durable rollup is
//                   what makes multi-day P&L real.
//
// All writers are best-effort: economics bookkeeping must never break the
// passes that feed it.

const DAO = 1e9; // 1 TAO = 1e9 rAO
const DEVOPS_INTERVAL_S = 90; // matches INTERVALS.devops in workers.ts

/** UTC "YYYY-MM-DD" for a Date. */
export function utcDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Latest known TAO/USD from the market worker's ChainSnapshot (no fetch). */
async function latestTaoPrice(): Promise<number | null> {
  try {
    const snap = await db.chainSnapshot.findFirst({
      orderBy: { createdAt: "desc" },
      select: { taoPriceUsd: true },
    });
    const p = snap?.taoPriceUsd ?? 0;
    return p > 0 ? p : null;
  } catch {
    return null;
  }
}

/**
 * Accrue one pass-interval of runtime cost for a started deployment.
 * Called by the DevOps worker pass for every started deployment.
 */
export async function accrueSpend(dep: {
  id: string;
  provider: string;
  gpuModel: string;
  hourlyCost: number;
}): Promise<void> {
  try {
    const hours = DEVOPS_INTERVAL_S / 3600;
    const cost = dep.hourlyCost * hours;
    const day = utcDay();
    await db.spendLedger.upsert({
      where: { deploymentId_day: { deploymentId: dep.id, day } },
      update: {
        hoursRun: { increment: hours },
        costUsd: { increment: cost },
        provider: dep.provider,
        gpuModel: dep.gpuModel,
      },
      create: {
        deploymentId: dep.id,
        day,
        provider: dep.provider,
        gpuModel: dep.gpuModel,
        hoursRun: hours,
        costUsd: cost,
      },
    });
  } catch (e) {
    console.error(
      "[economics] accrueSpend failed",
      dep.id,
      e instanceof Error ? e.message : e
    );
  }
}

/**
 * Accumulate one chain emission sample into the daily earnings rollup.
 * `emissionTao` is the raw per-UID cumulative emission (TAO) read from the
 * metagraph. Deltas clamp at 0 so a deregistration reset never books
 * phantom earnings.
 */
export async function rollupEarnings(
  dep: { id: string; hotkey: string; netuid: number },
  emissionTao: number | null
): Promise<void> {
  if (emissionTao === null || !Number.isFinite(emissionTao) || emissionTao < 0) {
    return;
  }
  try {
    const day = utcDay();
    const existing = await db.earningsDaily.findUnique({
      where: { deploymentId_day: { deploymentId: dep.id, day } },
    });
    const delta =
      existing?.lastEmissionTao != null
        ? Math.max(0, emissionTao - existing.lastEmissionTao)
        : 0; // first sample of a day: baseline only, no booked earnings
    const price = await latestTaoPrice();
    const earnedTao = (existing?.earnedTao ?? 0) + delta;
    await db.earningsDaily.upsert({
      where: { deploymentId_day: { deploymentId: dep.id, day } },
      update: {
        earnedTao,
        earnedUsd: price ? earnedTao * price : 0,
        taoPriceUsd: price,
        lastEmissionTao: emissionTao,
        samples: { increment: 1 },
      },
      create: {
        deploymentId: dep.id,
        day,
        hotkey: dep.hotkey,
        netuid: dep.netuid,
        earnedTao: 0,
        earnedUsd: 0,
        taoPriceUsd: price,
        lastEmissionTao: emissionTao,
        samples: 1,
      },
    });
  } catch (e) {
    console.error(
      "[economics] rollupEarnings failed",
      dep.id,
      e instanceof Error ? e.message : e
    );
  }
}

// ---------------------------------------------------------------------------
// Read model — /api/economics
// ---------------------------------------------------------------------------

export interface EconomicsDay {
  day: string;
  spendUsd: number;
  earnedTao: number;
  earnedUsd: number;
}

export interface EconomicsSummary {
  days: EconomicsDay[];
  totals: {
    spendUsd: number;
    earnedTao: number;
    earnedUsd: number;
    netUsd: number;
  };
  byDeployment: {
    deploymentId: string;
    minerName: string;
    netuid: number;
    spendUsd: number;
    earnedTao: number;
    earnedUsd: number;
  }[];
  hasData: boolean;
}

/** Fleet economics over the last `days` UTC days (default 30). */
export async function getEconomicsSummary(days = 30): Promise<EconomicsSummary> {
  const since = utcDay(new Date(Date.now() - (days - 1) * 86_400_000));

  const [spend, earned, deps] = await Promise.all([
    db.spendLedger.groupBy({
      by: ["day"],
      where: { day: { gte: since } },
      _sum: { costUsd: true },
      orderBy: { day: "asc" },
    }),
    db.earningsDaily.groupBy({
      by: ["day"],
      where: { day: { gte: since } },
      _sum: { earnedTao: true, earnedUsd: true },
      orderBy: { day: "asc" },
    }),
    db.deployment.findMany({
      select: {
        id: true,
        minerName: true,
        netuid: true,
      },
    }),
  ]);

  const daySet = new Set<string>([...spend.map((s) => s.day), ...earned.map((e) => e.day)]);
  const dayList: EconomicsDay[] = [...daySet].sort().map((day) => {
    const s = spend.find((x) => x.day === day)?._sum.costUsd ?? 0;
    const e = earned.find((x) => x.day === day);
    return {
      day,
      spendUsd: round2(s),
      earnedTao: round6(e?._sum.earnedTao ?? 0),
      earnedUsd: round2(e?._sum.earnedUsd ?? 0),
    };
  });

  const [spendByDep, earnByDep] = await Promise.all([
    db.spendLedger.groupBy({
      by: ["deploymentId"],
      where: { day: { gte: since } },
      _sum: { costUsd: true },
    }),
    db.earningsDaily.groupBy({
      by: ["deploymentId"],
      where: { day: { gte: since } },
      _sum: { earnedTao: true, earnedUsd: true },
    }),
  ]);

  const byDeployment = deps
    .map((d) => {
      const s = spendByDep.find((x) => x.deploymentId === d.id)?._sum.costUsd ?? 0;
      const e = earnByDep.find((x) => x.deploymentId === d.id);
      return {
        deploymentId: d.id,
        minerName: d.minerName,
        netuid: d.netuid,
        spendUsd: round2(s),
        earnedTao: round6(e?._sum.earnedTao ?? 0),
        earnedUsd: round2(e?._sum.earnedUsd ?? 0),
      };
    })
    .filter((d) => d.spendUsd > 0 || d.earnedTao > 0);

  const spendUsd = round2(dayList.reduce((a, d) => a + d.spendUsd, 0));
  const earnedTao = round6(dayList.reduce((a, d) => a + d.earnedTao, 0));
  const earnedUsd = round2(dayList.reduce((a, d) => a + d.earnedUsd, 0));

  return {
    days: dayList,
    totals: { spendUsd, earnedTao, earnedUsd, netUsd: round2(earnedUsd - spendUsd) },
    byDeployment,
    hasData: dayList.length > 0,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}
