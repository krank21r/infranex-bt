"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchLiveGpuOffers,
  mergeGpuOffers,
  type LiveGpuSnapshot,
} from "./runpod";
import type { GPUOffer } from "./types";

export type { LiveGpuSnapshot };

async function fetchGpuOffers(): Promise<LiveGpuSnapshot> {
  const res = await fetch("/api/gpu-offers", { cache: "no-store" });
  if (!res.ok) throw new Error(`gpu-offers ${res.status}`);
  return res.json();
}

/** Polls /api/gpu-offers every 60s for live RunPod pricing. */
export function useGpuOffers() {
  return useQuery({
    queryKey: ["gpu-offers"],
    queryFn: fetchGpuOffers,
    refetchInterval: 60_000,
    select: (data) => ({
      ...data,
      isLive: data.source === "live",
    }),
  });
}

export type MergedGpuOffer = GPUOffer & {
  live?: boolean;
  source?: string;
};

/** Returns all offers (live RunPod + indicative other providers), sorted by VRAM. */
export function useMergedGpuOffers(): {
  offers: MergedGpuOffer[];
  snap: ReturnType<typeof useGpuOffers>["data"];
  isLive: boolean;
  isFetching: boolean;
  refetch: () => void;
} {
  const { data: snap, isFetching, refetch } = useGpuOffers();
  const offers = mergeGpuOffers(snap);
  return {
    offers,
    snap,
    isLive: snap?.source === "live",
    isFetching,
    refetch,
  };
}
