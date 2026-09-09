"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface SubnetOverride {
  netuid: number;
  name: string | null;
  description: string | null;
  category: string | null;
  minVramGb: number | null;
  recommendedGpu: string | null;
  githubUrl: string | null;
  website: string | null;
  tags: string | null;
}

async function fetchOverrides(): Promise<Map<number, Record<string, unknown>>> {
  const res = await fetch("/api/subnet-overrides", { cache: "no-store" });
  if (!res.ok) return new Map();
  const j = await res.json();
  const map = new Map<number, Record<string, unknown>>();
  for (const o of j.overrides as SubnetOverride[]) {
    const entry: Record<string, unknown> = {};
    if (o.name) entry.name = o.name;
    if (o.description) entry.description = o.description;
    if (o.category) entry.category = o.category;
    if (o.minVramGb != null) entry.minVramGb = o.minVramGb;
    if (o.recommendedGpu) entry.recommendedGpu = o.recommendedGpu;
    if (o.githubUrl) entry.githubUrl = o.githubUrl;
    if (o.website) entry.website = o.website;
    map.set(o.netuid, entry);
  }
  return map;
}

/** Fetches all subnet overrides (for merging into the subnet list). */
export function useSubnetOverrides() {
  return useQuery({
    queryKey: ["subnet-overrides"],
    queryFn: fetchOverrides,
    staleTime: 10_000,
  });
}

export interface ScrapedMetadataResult {
  netuid: number;
  curated: { name: string; description: string; minVramGb: number; recommendedGpu: string; githubUrl: string | null };
  override: SubnetOverride | null;
  github: {
    description: string | null;
    minVramGb: number | null;
    recommendedGpu: string | null;
    readmeUrl: string | null;
    requirementsUrl: string | null;
    rawReadmeSnippet: string | null;
    source: string;
    error?: string;
  } | null;
  metadataApi: { probed: string[]; found: boolean; data: Record<string, unknown> | null };
}

/** Scrapes GitHub + probes metadata APIs for a single subnet. */
export function useSubnetMetadata(netuid: number | null) {
  return useQuery({
    queryKey: ["subnet-metadata", netuid],
    queryFn: async () => {
      if (!netuid) return null;
      const res = await fetch(`/api/subnets/${netuid}/metadata`, { cache: "no-store" });
      if (!res.ok) throw new Error(`metadata ${res.status}`);
      return (await res.json()) as ScrapedMetadataResult;
    },
    enabled: !!netuid,
  });
}

export function useSaveOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      netuid: number;
      name?: string;
      description?: string;
      category?: string;
      minVramGb?: number;
      recommendedGpu?: string;
      githubUrl?: string;
      website?: string;
    }) => {
      const res = await fetch(`/api/subnets/${input.netuid}/override`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subnet-overrides"] });
    },
  });
}

export function useDeleteOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (netuid: number) => {
      const res = await fetch(`/api/subnets/${netuid}/override`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subnet-overrides"] });
    },
  });
}
