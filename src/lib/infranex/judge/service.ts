import { db } from "@/lib/db";
import { fetchLiveSnapshot } from "../chain";
import { subnets as curatedSubnets } from "../data";
import type { Subnet } from "../types";
import { fetchJudgeInputs, extractJudgeProfile } from "./extract";
import { buildCohort } from "./cohort";
import { simulateAgainstProfile } from "./simulate";
import type { JudgeProfileData, JudgeCohort, MinerSpec, SimulationResult } from "./types";

/**
 * Judge service — profile cache (6h TTL), chain-backed cohort telemetry,
 * run persistence.
 */

const PROFILE_TTL_MS = 6 * 60 * 60 * 1000;

interface MemProfile {
  data: JudgeProfileData;
  expiresAt: number;
}

const memCache = new Map<number, MemProfile>();

/** Resolve the repo URL for a subnet: chain identity first, curated fallback. */
async function resolveRepoUrl(netuid: number): Promise<{ url: string | null; fromChain: boolean }> {
  try {
    const snap = await fetchLiveSnapshot();
    const live = snap.subnets.find((s) => s.netuid === netuid);
    if (live?.identityGithub) return { url: live.identityGithub, fromChain: true };
  } catch {
    // chain unavailable — fall through to curated
  }
  const curated = curatedSubnets.find((s) => s.netuid === netuid);
  return { url: curated?.githubUrl ?? null, fromChain: false };
}

function subnetNameFor(netuid: number): string {
  return (
    curatedSubnets.find((s) => s.netuid === netuid)?.name ?? `Subnet ${netuid}`
  );
}

/** Best-known display name for a subnet (chain identity → curated). */
export async function resolveSubnetName(netuid: number): Promise<string> {
  try {
    const snap = await fetchLiveSnapshot();
    const live = snap.subnets.find((s) => s.netuid === netuid);
    if (live?.name) return live.name;
  } catch {
    // chain unavailable
  }
  return subnetNameFor(netuid);
}

async function fetchCohort(netuid: number): Promise<JudgeCohort> {
  // Cohort from live chain incentive vector; falls back to registration-only.
  try {
    const { getUidState } = await import("../metagraph");
    const state = await getUidState(netuid);
    if (state.vectors && state.vectors.registeredUids > 0) {
      return buildCohort({
        registeredUids: state.vectors.registeredUids,
        incentives: state.vectors.incentive,
      });
    }
    return buildCohort({ registeredUids: 0, incentives: [] });
  } catch {
    return buildCohort({ registeredUids: 0, incentives: [] });
  }
}

/** Build (or rebuild) a judge profile for a subnet. */
export async function buildJudgeProfile(
  netuid: number,
  subnetName: string
): Promise<JudgeProfileData> {
  const { url, fromChain } = await resolveRepoUrl(netuid);
  const sources: JudgeProfileData["sources"] = [];
  if (fromChain) sources.push({ kind: "chain", note: "repo url from on-chain identity" });
  else if (url) sources.push({ kind: "curated", note: "repo url from curated list" });

  let extracted: Awaited<ReturnType<typeof extractJudgeProfile>> | null = null;
  if (url) {
    const inputs = await fetchJudgeInputs(url);
    sources.push(...inputs.sources);
    extracted = extractJudgeProfile(inputs, subnetName);
  }

  const cohort = await fetchCohort(netuid);

  if (!extracted) {
    // No repo at all — priors only.
    const { extractJudgeProfile: noop } = await import("./extract");
    extracted = noop({ files: {}, tree: null, sources: [], treeFailed: false }, subnetName);
  }

  const data: JudgeProfileData = {
    netuid,
    subnetName,
    judgeKind: extracted.judgeKind,
    summary: extracted.summary,
    dimensions: extracted.dimensions,
    cohort,
    confidence: extracted.confidence,
    sources,
  };

  // Persist (upsert).
  await db.judgeProfile.upsert({
    where: { netuid },
    create: {
      netuid,
      subnetName,
      judgeKind: data.judgeKind,
      summary: data.summary,
      dimensionsJson: JSON.stringify(data.dimensions),
      cohortJson: JSON.stringify(data.cohort),
      confidence: data.confidence,
      sourcesJson: JSON.stringify(data.sources),
      fetchedAt: new Date(),
    },
    update: {
      subnetName,
      judgeKind: data.judgeKind,
      summary: data.summary,
      dimensionsJson: JSON.stringify(data.dimensions),
      cohortJson: JSON.stringify(data.cohort),
      confidence: data.confidence,
      sourcesJson: JSON.stringify(data.sources),
      fetchedAt: new Date(),
    },
  });

  memCache.set(netuid, { data, expiresAt: Date.now() + PROFILE_TTL_MS });
  return data;
}

/** Get a profile: memory cache → DB → build. `refresh` bypasses cache. */
export async function getJudgeProfile(
  netuid: number,
  refresh = false
): Promise<JudgeProfileData> {
  if (!refresh) {
    const mem = memCache.get(netuid);
    if (mem && Date.now() < mem.expiresAt) return mem.data;

    const row = await db.judgeProfile.findUnique({ where: { netuid } });
    if (row) {
      const age = Date.now() - row.fetchedAt.getTime();
      if (age < PROFILE_TTL_MS) {
        const data: JudgeProfileData = {
          netuid: row.netuid,
          subnetName: row.subnetName,
          judgeKind: row.judgeKind as JudgeProfileData["judgeKind"],
          summary: row.summary,
          dimensions: JSON.parse(row.dimensionsJson),
          cohort: JSON.parse(row.cohortJson),
          confidence: row.confidence,
          sources: JSON.parse(row.sourcesJson),
        };
        memCache.set(netuid, { data, expiresAt: Date.now() + PROFILE_TTL_MS });
        return data;
      }
    }
  }
  return buildJudgeProfile(netuid, subnetNameFor(netuid));
}

/** List all persisted profiles. */
export async function listJudgeProfiles() {
  const rows = await db.judgeProfile.findMany({ orderBy: { netuid: "asc" } });
  return rows.map((row) => ({
    netuid: row.netuid,
    subnetName: row.subnetName,
    judgeKind: row.judgeKind,
    summary: row.summary,
    dimensions: JSON.parse(row.dimensionsJson),
    cohort: JSON.parse(row.cohortJson),
    confidence: row.confidence,
    sources: JSON.parse(row.sourcesJson),
    fetchedAt: row.fetchedAt.toISOString(),
  }));
}

export async function saveJudgeRun(
  profile: JudgeProfileData,
  spec: MinerSpec,
  result: SimulationResult
) {
  await db.judgeRun.create({
    data: {
      netuid: profile.netuid,
      subnetName: profile.subnetName,
      specJson: JSON.stringify(spec),
      resultJson: JSON.stringify(result),
      composite: result.composite,
      verdict: result.verdict,
    },
  });
}

export async function listJudgeRuns(limit = 20) {
  const rows = await db.judgeRun.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((row) => ({
    id: row.id,
    netuid: row.netuid,
    subnetName: row.subnetName,
    spec: JSON.parse(row.specJson) as MinerSpec,
    result: JSON.parse(row.resultJson) as SimulationResult,
    composite: row.composite,
    verdict: row.verdict,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Run a simulation end-to-end: profile → simulate → persist. */
export async function runSimulation(netuid: number, spec: MinerSpec) {
  const profile = await getJudgeProfile(netuid);
  const result = simulateAgainstProfile(profile, spec);
  await saveJudgeRun(profile, spec, result);
  return { profile, result };
}

/** Subnets available for profiling (curated list, enriched with live names). */
export function listJudgeableSubnets(): Pick<
  Subnet,
  "netuid" | "name" | "symbol" | "category" | "githubUrl"
>[] {
  return curatedSubnets.map((s) => ({
    netuid: s.netuid,
    name: s.name,
    symbol: s.symbol,
    category: s.category,
    githubUrl: s.githubUrl,
  }));
}
