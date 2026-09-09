"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_PROFITABILITY_CONFIG,
  type ProfitabilityConfig,
} from "./profitability";

/**
 * Profitability Engine settings — the minimum entry rule ($/mo net profit
 * target) and every cost line. Persisted server-side so the rule is a real
 * parameter, not something buried in code.
 */
export function useProfitabilityConfig() {
  return useQuery<ProfitabilityConfig>({
    queryKey: ["profitability-config"],
    queryFn: async () => {
      const res = await fetch("/api/profitability-config", { cache: "no-store" });
      if (!res.ok) throw new Error(`config ${res.status}`);
      return res.json();
    },
    placeholderData: DEFAULT_PROFITABILITY_CONFIG,
    staleTime: 60_000,
  });
}

export function useSaveProfitabilityConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (config: ProfitabilityConfig) => {
      const res = await fetch("/api/profitability-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `save failed ${res.status}`);
      }
      return (await res.json()) as ProfitabilityConfig;
    },
    onSuccess: (saved) => {
      qc.setQueryData(["profitability-config"], saved);
    },
  });
}
