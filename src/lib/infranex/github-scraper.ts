/**
 * GitHub scraping service — fetches README.md and requirements.txt from
 * a subnet's GitHub repo to extract real descriptions and GPU requirements.
 *
 * Uses the GitHub raw content API (no auth needed for public repos, but
 * rate-limited to 60 req/hr without a token).
 */

export interface ScrapedMetadata {
  description: string | null;
  minVramGb: number | null;
  recommendedGpu: string | null;
  readmeUrl: string | null;
  requirementsUrl: string | null;
  rawReadmeSnippet: string | null;
  source: "github" | "error";
  error?: string;
}

interface RepoInfo {
  owner: string;
  repo: string;
  branch: string;
}

function parseGithubUrl(url: string): RepoInfo | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("github.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1], branch: parts[3] || "main" };
  } catch {
    return null;
  }
}

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
    return await res.text();
  } catch {
    return null;
  }
}

// Try multiple README filenames + branches
async function fetchReadme(info: RepoInfo): Promise<{ content: string; url: string } | null> {
  const branches = [info.branch, "main", "master"];
  const paths = ["README.md", "readme.md", "README.rst", "README.txt", "README"];
  for (const branch of branches) {
    for (const path of paths) {
      const content = await fetchRaw(info.owner, info.repo, branch, path);
      if (content) {
        return { content, url: `https://github.com/${info.owner}/${info.repo}/blob/${branch}/${path}` };
      }
    }
  }
  return null;
}

async function fetchRequirements(info: RepoInfo): Promise<{ content: string; url: string } | null> {
  const branches = [info.branch, "main", "master"];
  const paths = [
    "requirements.txt",
    "requirements-min.txt",
    "environment.yml",
    "pyproject.toml",
    "setup.py",
  ];
  for (const branch of branches) {
    for (const path of paths) {
      const content = await fetchRaw(info.owner, info.repo, branch, path);
      if (content) {
        return { content, url: `https://github.com/${info.owner}/${info.repo}/blob/${branch}/${path}` };
      }
    }
  }
  return null;
}

// Parse VRAM requirements from text (README or requirements)
function parseVram(text: string): number | null {
  // Look for patterns like "80GB VRAM", "80 GB", "VRAM: 80GB", "min 80GB"
  const patterns = [
    /(\d{2,3})\s*gb\s*vram/i,
    /vram[:\s]*(\d{2,3})\s*gb/i,
    /(\d{2,3})\s*gb\s*(?:gpu|memory)/i,
    /min(?:imum)?\s*(?:vram|gpu|memory)?[:\s]*(\d{2,3})\s*gb/i,
    /(\d{2,3})\s*gb\s*(?:required|minimum|recommended)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const v = parseInt(m[1], 10);
      if (v >= 4 && v <= 200) return v;
    }
  }
  return null;
}

// Parse recommended GPU model from text
function parseGpuModel(text: string): string | null {
  const patterns = [
    /(NVIDIA\s+H100\s*80GB)/i,
    /(NVIDIA\s+H100)/i,
    /(NVIDIA\s+A100\s*80GB)/i,
    /(NVIDIA\s+A100\s*40GB)/i,
    /(NVIDIA\s+A100)/i,
    /(NVIDIA\s+H200)/i,
    /(NVIDIA\s+B200)/i,
    /(RTX\s+4090)/i,
    /(RTX\s+3090)/i,
    /(RTX\s+A6000)/i,
    /(RTX\s+A5000)/i,
    /(NVIDIA\s+L40S)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].replace(/\s+/g, " ").trim();
  }
  return null;
}

// Parse description from README (first paragraph after the title)
function parseDescription(readme: string): string | null {
  const lines = readme.split("\n");
  let foundTitle = false;
  const descLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      foundTitle = true;
      continue;
    }
    if (foundTitle && trimmed && !trimmed.startsWith("!") && !trimmed.startsWith("[") && !trimmed.startsWith("<")) {
      descLines.push(trimmed);
      if (descLines.length >= 3) break;
    }
  }
  if (descLines.length === 0) return null;
  const desc = descLines.join(" ").replace(/[#*`]/g, "").trim();
  return desc.length > 10 && desc.length < 300 ? desc : null;
}

export async function scrapeGithubMetadata(
  githubUrl: string
): Promise<ScrapedMetadata> {
  const info = parseGithubUrl(githubUrl);
  if (!info) {
    return { description: null, minVramGb: null, recommendedGpu: null, readmeUrl: null, requirementsUrl: null, rawReadmeSnippet: null, source: "error", error: "Invalid GitHub URL" };
  }

  try {
    const [readmeResult, reqResult] = await Promise.all([
      fetchReadme(info),
      fetchRequirements(info),
    ]);

    const combinedText = [readmeResult?.content, reqResult?.content]
      .filter(Boolean)
      .join("\n\n");

    if (!combinedText) {
      return {
        description: null,
        minVramGb: null,
        recommendedGpu: null,
        readmeUrl: null,
        requirementsUrl: null,
        rawReadmeSnippet: null,
        source: "error",
        error: "No README or requirements found",
      };
    }

    return {
      description: readmeResult ? parseDescription(readmeResult.content) : null,
      minVramGb: parseVram(combinedText),
      recommendedGpu: parseGpuModel(combinedText),
      readmeUrl: readmeResult?.url ?? null,
      requirementsUrl: reqResult?.url ?? null,
      rawReadmeSnippet: readmeResult?.content.slice(0, 500) ?? null,
      source: "github",
    };
  } catch (e) {
    return {
      description: null,
      minVramGb: null,
      recommendedGpu: null,
      readmeUrl: null,
      requirementsUrl: null,
      rawReadmeSnippet: null,
      source: "error",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
