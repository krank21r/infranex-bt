import {
  DIMENSION_CATALOG,
  ARCHETYPE_PRIORS,
  type JudgeKind,
  type JudgeDimension,
  type JudgeEvidence,
  type JudgeSource,
} from "./types";

/**
 * Judge extraction — mines a subnet's validator scoring profile from its
 * own GitHub repo.
 *
 * Strategy (in order):
 *   1. raw.githubusercontent probing of known validator paths — NOT
 *      rate-limited, so we try liberally.
 *   2. GitHub git-trees API fallback — finds validator files wherever they
 *      live, but shares the 60 req/hr unauthenticated budget with the
 *      subnet-requirements profiler, so it degrades gracefully.
 *
 * extractJudgeProfile() itself is PURE (string inputs → profile) and is
 * unit-tested; fetchJudgeInputs() does the network I/O.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JudgeInputs {
  /** File contents keyed by repo-relative path. */
  files: Record<string, string>;
  /** Repo tree paths (when the tree API answered). */
  tree: string[] | null;
  /** Human-readable sources used. */
  sources: JudgeSource[];
  /** True when the tree API was rate-limited / failed. */
  treeFailed: boolean;
}

export interface ExtractedProfile {
  judgeKind: JudgeKind;
  summary: string;
  dimensions: JudgeDimension[];
  /** Numeric response deadline mined from code (ms), if any. */
  deadlineMs: number | null;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Repo URL parsing
// ---------------------------------------------------------------------------

export interface RepoInfo {
  owner: string;
  repo: string;
  branch: string;
}

export function parseGithubUrl(url: string): RepoInfo | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("github.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    // .../tree/branch/... → branch is parts[2] after tree
    if (parts[2] === "tree" && parts[3]) {
      return { owner: parts[0], repo: parts[1], branch: parts[3] };
    }
    return { owner: parts[0], repo: parts[1], branch: "main" };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Network I/O — fetchJudgeInputs
// ---------------------------------------------------------------------------

/** Candidate validator paths probed on raw.githubusercontent (unthrottled). */
const VALIDATOR_PATHS = [
  "neurons/validator.py",
  "neurons/validators.py",
  "validator.py",
  "validators/validator.py",
  "neuron/validator.py",
  "src/validator.py",
  "validator/validator.py",
  "neurons/base/validator.py",
];

const README_PATHS = ["README.md", "readme.md", "README.rst"];

async function fetchRaw(
  owner: string,
  repo: string,
  branch: string,
  path: string
): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "infranex-bt/1.0" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const text = await res.text();
    // GitHub raw returns "404: Not Found" body with 200 in rare edge cases
    if (text.startsWith("404: Not Found") || text.length < 10) return null;
    return text;
  } catch {
    return null;
  }
}

async function fetchRepoTree(info: RepoInfo): Promise<{ paths: string[]; failed: boolean }> {
  const url = `https://api.github.com/repos/${info.owner}/${info.repo}/git/trees/${info.branch}?recursive=1`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "infranex-bt/1.0", Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!res.ok) return { paths: [], failed: true };
    const j = (await res.json()) as { tree?: Array<{ path: string; type: string }> };
    return { paths: (j.tree ?? []).filter((t) => t.type === "blob").map((t) => t.path), failed: false };
  } catch {
    return { paths: [], failed: true };
  }
}

/**
 * Fetch the raw inputs for judge extraction. Unthrottled raw probing first;
 * git-trees API as a fallback to discover validator files that live outside
 * the standard paths.
 */
export async function fetchJudgeInputs(githubUrl: string): Promise<JudgeInputs> {
  const info = parseGithubUrl(githubUrl);
  if (!info) {
    return { files: {}, tree: null, sources: [], treeFailed: false };
  }

  const files: Record<string, string> = {};
  const sources: JudgeSource[] = [];
  const branches = [info.branch, "main", "master"].filter(
    (b, i, arr) => arr.indexOf(b) === i
  );

  // 1. Unthrottled raw probing — validator code + README.
  outer: for (const path of VALIDATOR_PATHS) {
    for (const branch of branches) {
      const content = await fetchRaw(info.owner, info.repo, branch, path);
      if (content) {
        files[path] = content;
        sources.push({
          kind: "validator_code",
          url: `https://github.com/${info.owner}/${info.repo}/blob/${branch}/${path}`,
          note: `Probed raw.githubusercontent (${path} @ ${branch})`,
        });
        break outer;
      }
    }
  }

  for (const path of README_PATHS) {
    for (const branch of branches) {
      const content = await fetchRaw(info.owner, info.repo, branch, path);
      if (content) {
        files[path] = content;
        sources.push({
          kind: "readme",
          url: `https://github.com/${info.owner}/${info.repo}/blob/${branch}/${path}`,
        });
        break;
      }
    }
    if (files[path]) break;
  }

  // 2. Tree fallback — only if no validator file was found by probing.
  let treePaths: string[] | null = null;
  let treeFailed = false;
  if (!Object.keys(files).some((p) => p.endsWith("validator.py"))) {
    const t = await fetchRepoTree(info);
    treeFailed = t.failed;
    treePaths = t.failed ? null : t.paths;
    if (t.failed) {
      sources.push({
        kind: "tree",
        note: "GitHub trees API unavailable (likely 60 req/hr rate limit shared with the requirements profiler).",
      });
    } else {
      sources.push({ kind: "tree", note: "git-trees enumeration succeeded" });
      // Find validator-looking files, excluding obvious launchers.
      const candidates = t.paths
        .filter((p) => p.endsWith(".py") && /validat/i.test(p))
        .filter((p) => !/scripts\/(start|run|launch)/i.test(p))
        .slice(0, 3);
      for (const path of candidates) {
        for (const branch of branches) {
          const content = await fetchRaw(info.owner, info.repo, branch, path);
          if (content) {
            files[path] = content;
            sources.push({
              kind: "validator_code",
              url: `https://github.com/${info.owner}/${info.repo}/blob/${branch}/${path}`,
              note: "Discovered via git-trees fallback",
            });
            break;
          }
        }
        if (files[path]) break;
      }
    }
  }

  return { files, tree: treePaths, sources, treeFailed };
}

// ---------------------------------------------------------------------------
// Pure extraction — extractJudgeProfile
// ---------------------------------------------------------------------------

/** Max evidence lines kept per dimension. */
const MAX_EVIDENCE_PER_DIM = 4;
/** Min code-evidence hits before we trust the classification. */
const MIN_HITS_FOR_CLASSIFICATION = 5;

/**
 * A line matching any of these is treated as plumbing, not a scoring rule —
 * e.g. SN1 Apex's `process.wait(timeout=10)` looks like a deadline to a
 * keyword matcher but is just subprocess hygiene.
 */
const TIMEOUT_NOISE_PATTERNS = [
  /wait\s*\(/i,
  /sleep\s*\(/i,
  /subprocess/i,
  /popen/i,
  /join\s*\(/i,
];

export function extractDeadlineMs(files: Record<string, string>): number | null {
  for (const [file, content] of Object.entries(files)) {
    if (!file.endsWith(".py")) continue;
    const lines = content.split("\n");
    for (const line of lines) {
      if (!/timeout|deadline|time_limit|synapse/i.test(line)) continue;
      if (TIMEOUT_NOISE_PATTERNS.some((re) => re.test(line))) continue;
      // Look for a numeric seconds value on the line.
      const m = line.match(/(\d+(?:\.\d+)?)\s*(?:s\b|sec|seconds?)?/gi);
      if (!m) continue;
      for (const raw of m) {
        const n = parseFloat(raw);
        if (!Number.isFinite(n)) continue;
        // Plausible validator response deadlines: 1s … 30min.
        if (n >= 1 && n <= 1800) return Math.round(n * 1000);
      }
    }
  }
  return null;
}

/**
 * Word-start prefix match — "ping" must NOT match "ty|ping|" (trailing), but
 * "price" matches "pricing"/"priced", "evaluat" matches "evaluation".
 */
function lineMatches(line: string, kw: string): boolean {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}`, "i").test(line);
}

export function extractJudgeProfile(inputs: JudgeInputs, subnetName: string): ExtractedProfile {
  const codeFiles = Object.entries(inputs.files).filter(([f]) => f.endsWith(".py"));
  const readmeFiles = Object.entries(inputs.files).filter(([f]) => !f.endsWith(".py"));

  // --- 1. Keyword evidence scan (code and readme tracked separately) ------
  const evidenceByDim = new Map<string, JudgeEvidence[]>();
  const codeHits = new Map<string, number>();
  const readmeHits = new Map<string, number>();

  for (const dim of DIMENSION_CATALOG) {
    evidenceByDim.set(dim.key, []);
    codeHits.set(dim.key, 0);
    readmeHits.set(dim.key, 0);
  }

  const scan = (file: string, content: string, isCode: boolean) => {
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length > 400) continue;
      if (isCode && TIMEOUT_NOISE_PATTERNS.some((re) => re.test(trimmed))) continue;
      for (const dim of DIMENSION_CATALOG) {
        const matched = dim.keywords.filter(
          (kw) =>
            lineMatches(trimmed, kw) &&
            // Generic infra terms only count as evidence in real code.
            (isCode || !dim.codeOnlyKeywords?.includes(kw))
        );
        if (!matched.length) continue;
        const target = isCode ? codeHits : readmeHits;
        target.set(dim.key, (target.get(dim.key) ?? 0) + matched.length);
        const ev = evidenceByDim.get(dim.key)!;
        if (ev.length < MAX_EVIDENCE_PER_DIM) {
          ev.push({ file, line: trimmed, matched });
        }
      }
    }
  };

  for (const [file, content] of codeFiles) scan(file, content, true);
  for (const [file, content] of readmeFiles) scan(file, content, false);

  // --- 2. Archetype classification ---------------------------------------
  // Code evidence is what actually runs — double-weight it. README-only
  // repos need STRONG dominance to classify (prose is noisy).
  const effectiveHits = new Map<string, number>();
  let totalCode = 0;
  let totalEffective = 0;
  for (const dim of DIMENSION_CATALOG) {
    const c = codeHits.get(dim.key) ?? 0;
    const r = readmeHits.get(dim.key) ?? 0;
    totalCode += c;
    const eff = c * 2 + r;
    effectiveHits.set(dim.key, eff);
    totalEffective += eff;
  }

  let judgeKind: JudgeKind = "unknown";
  if (totalCode >= MIN_HITS_FOR_CLASSIFICATION) {
    const ranked = [...effectiveHits.entries()].sort((a, b) => b[1] - a[1]);
    const [topKey, topHits] = ranked[0];
    const [, secondHits] = ranked[1] ?? ["", 0];
    if (topHits >= 3 && topHits >= secondHits * 1.5) {
      judgeKind = kindForDimension(topKey);
    }
  } else {
    // README-only classification — require clear dominance (2×) + volume.
    const ranked = [...readmeHits.entries()].sort((a, b) => b[1] - a[1]);
    const [topKey, topHits] = ranked[0];
    const [, secondHits] = ranked[1] ?? ["", 0];
    if (topHits >= 6 && topHits >= secondHits * 2) {
      judgeKind = kindForDimension(topKey);
    }
  }

  // --- 3. Weight blend: 50% evidence / 50% archetype prior -----------------
  const prior = ARCHETYPE_PRIORS[judgeKind];
  const dimensions: JudgeDimension[] = [];
  if (totalEffective > 0) {
    for (const dim of DIMENSION_CATALOG) {
      const h = effectiveHits.get(dim.key) ?? 0;
      const evidenceWeight = h / totalEffective;
      const weight = 0.5 * evidenceWeight + 0.5 * (prior[dim.key] ?? 0);
      dimensions.push({
        key: dim.key,
        label: dim.label,
        weight: Math.round(weight * 1000) / 1000,
        evidence: evidenceByDim.get(dim.key) ?? [],
      });
    }
    // Normalize to Σ = 1 and re-round.
    const sum = dimensions.reduce((a, d) => a + d.weight, 0) || 1;
    for (const d of dimensions) d.weight = Math.round((d.weight / sum) * 1000) / 1000;
    const drift = 1 - dimensions.reduce((a, d) => a + d.weight, 0);
    // Give drift to the largest weight.
    if (dimensions.length) {
      const largest = dimensions.reduce((a, b) => (b.weight > a.weight ? b : a));
      largest.weight = Math.round((largest.weight + drift) * 1000) / 1000;
    }
  } else {
    for (const dim of DIMENSION_CATALOG) {
      dimensions.push({
        key: dim.key,
        label: dim.label,
        weight: prior[dim.key] ?? 0,
        evidence: [],
      });
    }
  }

  // --- 4. Deadline mining ---------------------------------------------------
  const deadlineMs = extractDeadlineMs(inputs.files);

  // --- 5. Confidence --------------------------------------------------------
  // Evidence volume + classification strength + deadline presence.
  const volumeScore = Math.min(1, totalEffective / 30);
  const classificationScore = judgeKind !== "unknown" ? 1 : 0;
  const deadlineScore = deadlineMs ? 1 : 0;
  const readmeScore = readmeFiles.length ? 0.2 : 0;
  const confidence = Math.round(
    (0.4 * volumeScore + 0.3 * classificationScore + 0.1 * deadlineScore + 0.2 * readmeScore) * 100
  ) / 100;

  // --- 6. Summary -----------------------------------------------------------
  const summary = buildSummary(judgeKind, dimensions, deadlineMs, subnetName, totalEffective);

  return { judgeKind, summary, dimensions, deadlineMs, confidence };
}

function kindForDimension(key: string): JudgeKind {
  switch (key) {
    case "response_speed": return "latency_race";
    case "response_quality": return "quality_judge";
    case "price": return "market_clearing";
    case "availability": return "uptime_sla";
    case "resource_efficiency": return "resource_fit";
    // Throughput-dominant repos are usually marketplaces too.
    case "throughput": return "market_clearing";
    default: return "unknown";
  }
}

function buildSummary(
  kind: JudgeKind,
  dimensions: JudgeDimension[],
  deadlineMs: number | null,
  subnetName: string,
  evidenceHits: number
): string {
  if (evidenceHits === 0) {
    return `Judge for ${subnetName} could not be classified from repo evidence — weights are archetype priors. Dominant axes: ${topAxes(dimensions, 2)}.`;
  }
  const axes = topAxes(dimensions, 2);
  const deadlinePart = deadlineMs
    ? ` A response deadline of ~${deadlineMs / 1000}s was mined from the validator code.`
    : "";
  return `Judge for ${subnetName} classified as ${kind.replace("_", " ")} from ${evidenceHits} evidence hits. Dominant axes: ${axes}.${deadlinePart}`;
}

function topAxes(dimensions: JudgeDimension[], n: number): string {
  return [...dimensions]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, n)
    .filter((d) => d.weight > 0)
    .map((d) => `${d.label} (${Math.round(d.weight * 100)}%)`)
    .join(" and ") || "none";
}
