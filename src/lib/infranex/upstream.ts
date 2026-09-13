import { db } from "@/lib/db";
import { commitFinding } from "./triggers-core";
import { subnets } from "./data";

/**
 * TIER3 — Git intelligence (upstream watcher).
 *
 * Config drift (DEVOPS-2) already re-pulls the subnet requirements profile;
 * it can't see the thing that matters most: the upstream repo MOVING. This
 * watcher tracks, per deployed subnet, the repo's latest release tag and
 * latest commit SHA via the GitHub API:
 *
 *   pass 1 (unknown repo)   → adopt the current tag/SHA as the baseline.
 *                             No event — adopting is not a finding.
 *   pass N (repo moved)     → commit an UPSTREAM_DRIFT trigger event with
 *                             prev→latest evidence + whether the deployment
 *                             was provisioned BEFORE the change (i.e. it is
 *                             provably running behind upstream).
 *   pass N+1 (no change)    → nothing (state already updated).
 *
 * Approval path: the UPSTREAM_DRIFT act handler re-pulls the requirements
 * profile onto the GPU (same implementation path as drift resync), so
 * "pull upstream changes" is one click.
 *
 * Repo resolution order per deployment:
 *   requirementsJsonSnapshot.profile.repoUrl → SubnetOverride.githubUrl →
 *   curated subnets githubUrl (data.ts).
 */

export interface UpstreamLatest {
  repoUrl: string;
  tag: string | null;
  tagPublishedAt: string | null;
  sha: string | null;
  shaCommittedAt: string | null;
  releaseUrl: string | null;
}

export interface UpstreamPassResult {
  evaluatedAt: string;
  watched: number;
  adopted: number;
  changed: number;
  unchanged: number;
  errors: number;
  findings: { netuid: number; repoUrl: string; change: string }[];
}

type UpstreamFetcher = (repoUrl: string, branch: string) => Promise<UpstreamLatest | null>;

const FETCH_TIMEOUT_MS = 12_000;
const GH = "https://api.github.com";

function ownerRepo(repoUrl: string): { owner: string; repo: string } | null {
  const m = repoUrl.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
}

/** Default fetcher — GitHub API: latest release + latest commit on a branch. */
export const fetchUpstreamLatest: UpstreamFetcher = async (repoUrl, branch) => {
  const or = ownerRepo(repoUrl);
  if (!or) return null;
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "infranex-bt/1.0",
  };
  const out: UpstreamLatest = { repoUrl, tag: null, tagPublishedAt: null, sha: null, shaCommittedAt: null, releaseUrl: null };
  try {
    const rel = await fetch(`${GH}/repos/${or.owner}/${or.repo}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (rel.ok) {
      const j = (await rel.json()) as { tag_name?: string; published_at?: string; html_url?: string };
      out.tag = j.tag_name ?? null;
      out.tagPublishedAt = j.published_at ?? null;
      out.releaseUrl = j.html_url ?? null;
    }
  } catch {
    // release endpoint failed — commit check below still runs
  }
  try {
    const com = await fetch(`${GH}/repos/${or.owner}/${or.repo}/commits/${encodeURIComponent(branch || "main")}?per_page=1`, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (com.ok) {
      const j = (await com.json()) as { sha?: string; commit?: { committer?: { date?: string } } };
      out.sha = j.sha ?? null;
      out.shaCommittedAt = j.commit?.committer?.date ?? null;
    }
  } catch {
    // ignore — partial info is still usable
  }
  if (out.tag === null && out.sha === null) return null;
  return out;
};

/** Resolve the upstream repo for a deployment. */
export async function resolveRepoUrl(netuid: number, requirementsSnapshot: string | null): Promise<string | null> {
  if (requirementsSnapshot) {
    try {
      const snap = JSON.parse(requirementsSnapshot) as { repoUrl?: unknown };
      if (typeof snap.repoUrl === "string" && snap.repoUrl.includes("github.com")) return snap.repoUrl;
    } catch {
      // fall through
    }
  }
  const override = await db.subnetOverride.findUnique({ where: { netuid } });
  if (override?.githubUrl) return override.githubUrl;
  const curated = subnets.find((s) => s.netuid === netuid);
  return curated?.githubUrl ?? null;
}

function summarizeChange(prev: { tag: string | null; sha: string | null }, next: UpstreamLatest): string {
  const tagChanged = next.tag !== null && next.tag !== prev.tag;
  const shaChanged = next.sha !== null && next.sha !== prev.sha;
  if (tagChanged && shaChanged) return `release ${prev.tag ?? "none"} → ${next.tag}, new commit`;
  if (tagChanged) return `release ${prev.tag ?? "none"} → ${next.tag}`;
  if (shaChanged) return `new commit on branch (was ${prev.sha?.slice(0, 7) ?? "unknown"})`;
  return "no change";
}

export interface UpstreamPassOptions {
  fetchLatest?: UpstreamFetcher;
  /** DI: deployments to watch (tests). Defaults to started deployments. */
  deployments?: { id: string; netuid: number; minerName: string; mode: string; status: string; requirementsJsonSnapshot: string | null }[];
}

export async function runUpstreamPass(opts?: UpstreamPassOptions): Promise<UpstreamPassResult> {
  const fetchLatest = opts?.fetchLatest ?? fetchUpstreamLatest;
  const rows =
    opts?.deployments ??
    (await db.deployment.findMany({
      where: { status: "started" },
      select: { id: true, netuid: true, minerName: true, mode: true, status: true, requirementsJsonSnapshot: true },
    }));

  const result: UpstreamPassResult = {
    evaluatedAt: new Date().toISOString(),
    watched: 0,
    adopted: 0,
    changed: 0,
    unchanged: 0,
    errors: 0,
    findings: [],
  };

  const seen = new Set<number>();
  for (const dep of rows) {
    if (seen.has(dep.netuid)) continue; // one check per subnet, not per miner
    seen.add(dep.netuid);
    result.watched++;

    const repoUrl = await resolveRepoUrl(dep.netuid, dep.requirementsJsonSnapshot);
    if (!repoUrl) {
      result.errors++;
      continue;
    }

    let latest: UpstreamLatest | null = null;
    try {
      latest = await fetchLatest(repoUrl, "main");
    } catch {
      latest = null;
    }
    if (!latest) {
      result.errors++;
      continue;
    }

    const state = await db.upstreamState.findUnique({ where: { netuid: dep.netuid } });

    if (!state) {
      // Baseline adoption — record where upstream is NOW; not a finding.
      await db.upstreamState.create({
        data: {
          netuid: dep.netuid,
          repoUrl,
          lastTag: latest.tag,
          lastTagAt: latest.tagPublishedAt ? new Date(latest.tagPublishedAt) : null,
          lastSha: latest.sha,
          lastShaAt: latest.shaCommittedAt ? new Date(latest.shaCommittedAt) : null,
          checkedAt: new Date(),
        },
      });
      result.adopted++;
      continue;
    }

    const change = summarizeChange({ tag: state.lastTag, sha: state.lastSha }, latest);
    if (change === "no change") {
      result.unchanged++;
      continue;
    }

    // Upstream moved — was the deployment provisioned before the change?
    const deployedAt = dep.requirementsJsonSnapshot
      ? snapshotFetchedAt(dep.requirementsJsonSnapshot)
      : null;
    const upstreamIso = latest.tagPublishedAt ?? latest.shaCommittedAt;
    const upstreamAt = upstreamIso ? new Date(upstreamIso) : null;
    const behind =
      deployedAt !== null &&
      upstreamAt !== null &&
      !Number.isNaN(upstreamAt.getTime()) &&
      deployedAt < upstreamAt;

    const target = dep.minerName;
    await commitFinding({
      kind: "UPSTREAM_DRIFT",
      severity: behind ? "warning" : "info",
      dedupeKey: `${dep.netuid}:upstream`,
      title: `Upstream moved for α${dep.netuid} — ${change}`,
      detail:
        `${repoUrl}: ${change}. ` +
        (behind
          ? `"${target}" was provisioned from a profile fetched ${deployedAt?.toISOString().slice(0, 10)} — it is provably running behind upstream.`
          : `Deployed profile is newer than or equal to the upstream change — informational.`),
      evidence: {
        netuid: dep.netuid,
        repoUrl,
        previousTag: state.lastTag,
        latestTag: latest.tag,
        previousSha: state.lastSha?.slice(0, 7) ?? null,
        latestSha: latest.sha?.slice(0, 7) ?? null,
        releaseUrl: latest.releaseUrl,
        change,
        deployedProfileFetchedAt: deployedAt?.toISOString() ?? null,
        runningBehind: behind,
        mode: dep.mode,
      },
      deploymentId: dep.id,
      netuid: dep.netuid,
      runbook: [
        "Open the release/commit diff and check for breaking miner changes.",
        "Approve to re-pull the subnet requirements profile onto the GPU (same path as drift resync).",
        "If the miner code must be reinstalled, re-run setup from the Deployments view after the resync.",
      ],
    });
    result.changed++;
    result.findings.push({ netuid: dep.netuid, repoUrl, change });

    // Advance the baseline so the next pass is quiet until ANOTHER move.
    await db.upstreamState.update({
      where: { netuid: dep.netuid },
      data: {
        repoUrl,
        lastTag: latest.tag,
        lastTagAt: latest.tagPublishedAt ? new Date(latest.tagPublishedAt) : null,
        lastSha: latest.sha,
        lastShaAt: latest.shaCommittedAt ? new Date(latest.shaCommittedAt) : null,
        checkedAt: new Date(),
      },
    });
  }

  return result;
}

function snapshotFetchedAt(requirementsSnapshot: string): Date | null {
  try {
    const v = JSON.parse(requirementsSnapshot) as { fetchedAt?: string };
    if (typeof v.fetchedAt === "string") {
      const d = new Date(v.fetchedAt);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  } catch {
    // ignore
  }
  return null;
}
