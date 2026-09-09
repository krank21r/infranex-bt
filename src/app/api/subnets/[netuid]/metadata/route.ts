import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { scrapeGithubMetadata } from "@/lib/infranex/github-scraper";
import { subnets } from "@/lib/infranex/data";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/subnets/[netuid]/metadata — scrape GitHub + probe metadata APIs
// for real descriptions and GPU requirements.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ netuid: string }> }
) {
  const { netuid } = await params;
  const n = parseInt(netuid, 10);

  // Find the curated subnet
  const curated = subnets.find((s) => s.netuid === n);
  if (!curated) {
    return NextResponse.json({ error: "Subnet not found" }, { status: 404 });
  }

  // Check for user override (may have a githubUrl)
  const override = await db.subnetOverride.findUnique({ where: { netuid: n } });
  const githubUrl = override?.githubUrl ?? curated.githubUrl ?? null;

  const result: {
    netuid: number;
    curated: { name: string; description: string; minVramGb: number; recommendedGpu: string; githubUrl: string | null };
    override: typeof override;
    github: Awaited<ReturnType<typeof scrapeGithubMetadata>> | null;
    metadataApi: { probed: string[]; found: boolean; data: Record<string, unknown> | null };
  } = {
    netuid: n,
    curated: {
      name: curated.name,
      description: curated.description,
      minVramGb: curated.minVramGb,
      recommendedGpu: curated.recommendedGpu,
      githubUrl,
    },
    override,
    github: null,
    metadataApi: { probed: [], found: false, data: null },
  };

  // 1. Scrape GitHub if we have a URL
  if (githubUrl) {
    result.github = await scrapeGithubMetadata(githubUrl);
  }

  // 2. Probe common subnet metadata API endpoints
  // Some subnets expose metadata at predictable URLs
  const probeUrls = [
    `https://subnets.network/api/subnet/${n}`,
    `https://api.taostats.io/api/v2/subnet/${n}`,
  ];
  for (const url of probeUrls) {
    result.metadataApi.probed.push(url);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "infranex-bt/1.0", Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const j = await res.json();
        result.metadataApi.found = true;
        result.metadataApi.data = j;
        break;
      }
    } catch {
      // continue probing
    }
  }

  return NextResponse.json(result);
}
