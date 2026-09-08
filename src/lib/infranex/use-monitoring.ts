"use client";

import { useQuery } from "@tanstack/react-query";
import type { MonitoringOverview } from "@/lib/infranex/monitoring";

export type { MonitoringOverview };

async function fetchMonitoring(): Promise<MonitoringOverview> {
  const res = await fetch("/api/monitoring", { cache: "no-store" });
  if (!res.ok) throw new Error(`monitoring ${res.status}`);
  return res.json();
}

/** Polls /api/monitoring every 30s for live deployment metrics. */
export function useMonitoring() {
  return useQuery({
    queryKey: ["monitoring"],
    queryFn: fetchMonitoring,
    refetchInterval: 30_000,
    select: (data) => ({
      ...data,
      isLive: data.source === "live",
    }),
  });
}
