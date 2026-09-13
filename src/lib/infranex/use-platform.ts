"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// WALLET-ECON-1 — client hooks for the live-mining persistence layer:
// wallet profiles (public metadata), platform settings, the audit trail,
// and fleet economics. All endpoints are session-gated; settings PUT and
// the audit GET are admin-only (UI hides those cards for members).

export interface WalletProfile {
  id: string;
  label: string;
  walletName: string;
  hotkeyName: string;
  coldAddress: string | null;
  hotAddress: string | null;
  notes: string;
  isDefault: boolean;
  createdAt: string;
}

export interface WalletProfileInput {
  label: string;
  walletName: string;
  hotkeyName: string;
  coldAddress?: string;
  hotAddress?: string;
  notes?: string;
}

export interface PlatformSettings {
  chainNetwork: string;
  defaultWalletProfileId: string | null;
  registrationBufferTao: number;
  masterKeyBackedUpAt: string | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  actor: string;
  target: string | null;
  detail: string;
  createdAt: string;
}

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

async function parseError(res: Response): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? `request failed ${res.status}`;
}

export function useWallets() {
  return useQuery<WalletProfile[]>({
    queryKey: ["wallets"],
    queryFn: async () => {
      const res = await fetch("/api/wallets", { cache: "no-store" });
      if (!res.ok) throw new Error(await parseError(res));
      const j = (await res.json()) as { wallets: WalletProfile[] };
      return j.wallets;
    },
    staleTime: 30_000,
  });
}

export function useCreateWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: WalletProfileInput) => {
      const res = await fetch("/api/wallets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(await parseError(res));
      return (await res.json()) as { wallet: WalletProfile };
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["wallets"] }),
  });
}

export function useUpdateWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; isDefault?: boolean; label?: string; notes?: string }) => {
      const res = await fetch(`/api/wallets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await parseError(res));
      return (await res.json()) as { wallet: WalletProfile };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["wallets"] });
      void qc.invalidateQueries({ queryKey: ["platform-settings"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

export function useDeleteWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/wallets/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await parseError(res));
      return { ok: true };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["wallets"] });
      void qc.invalidateQueries({ queryKey: ["platform-settings"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

export function usePlatformSettings() {
  return useQuery<PlatformSettings>({
    queryKey: ["platform-settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (!res.ok) throw new Error(await parseError(res));
      const j = (await res.json()) as { settings: PlatformSettings };
      return j.settings;
    },
    staleTime: 30_000,
  });
}

export function useSavePlatformSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: { chainNetwork?: string; registrationBufferTao?: number; defaultWalletProfileId?: string | null }) => {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await parseError(res));
      return (await res.json()) as { settings: PlatformSettings };
    },
    onSuccess: (saved) => {
      qc.setQueryData(["platform-settings"], saved);
      void qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

export function useAckMasterKeyBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings", { method: "POST" });
      if (!res.ok) throw new Error(await parseError(res));
      return (await res.json()) as { settings: PlatformSettings };
    },
    onSuccess: (saved) => {
      qc.setQueryData(["platform-settings"], saved);
      void qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

export function useAudit(limit = 50) {
  return useQuery<AuditEntry[]>({
    queryKey: ["audit", limit],
    queryFn: async () => {
      const res = await fetch(`/api/audit?limit=${limit}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await parseError(res));
      const j = (await res.json()) as { entries: AuditEntry[] };
      return j.entries;
    },
    staleTime: 15_000,
  });
}

export function useEconomics(days = 30) {
  return useQuery<EconomicsSummary>({
    queryKey: ["economics", days],
    queryFn: async () => {
      const res = await fetch(`/api/economics?days=${days}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await parseError(res));
      return (await res.json()) as EconomicsSummary;
    },
    staleTime: 60_000,
  });
}
