// ---------------------------------------------------------------------------
// Wallet & Registration — the "connect" step of the mining journey.
//
// The DevOps engine deploys everything up to a running miner service, but two
// things can never be automated by the platform: creating your bittensor keys
// (they only ever live on YOUR laptop) and registering the hotkey to the
// subnet (it must be signed by the coldkey that pays the burn).
//
// This module keeps the persisted wizard state (wallet names, hotkey SS58,
// step checklist, on-chain verification result) and the exact btcli commands
// the wizard renders, parameterized by wallet name / netuid.
//
// NOTE: no "use client" here — the hook is only CALLED from client
// components, while the API route imports the pure helpers server-side.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from "react";

export const BLOCK_TIME_S = 12; // Finney average block time

const STORAGE_KEY = "infranex.walletRegistration";
export const SS58_RE = /^5[1-9A-HJ-NP-Za-km-z]{47}$/;

export interface WalletRegistrationState {
  /** btcli wallet name (directory under ~/.bittensor/wallets/). */
  walletName: string;
  /** btcli hotkey name (directory under .../hotkeys/). */
  hotkeyName: string;
  /** Subnet the registration flow targets (follows the journey). */
  netuid: number | null;
  /** Hotkey SS58 the user pasted for on-chain verification. */
  hotkeySs58: string;
  /** Ids of wizard steps the user marked as done ("1".."8"). */
  doneSteps: string[];
  /** UID returned by the live chain verification, if any. */
  verifiedUid: number | null;
  verifiedAt: number | null;
}

export const DEFAULT_WALLET_STATE: WalletRegistrationState = {
  walletName: "infranex",
  hotkeyName: "default",
  netuid: null,
  hotkeySs58: "",
  doneSteps: [],
  verifiedUid: null,
  verifiedAt: null,
};

/** Shape of GET /api/devops/wallet-registration. */
export interface WalletVerifyResponse {
  ok: boolean;
  error?: string;
  netuid?: number;
  hotkey?: string;
  registered?: boolean;
  uid?: number | null;
  blockNumber?: number;
  registeredUids?: number;
  active?: boolean | null;
  incentive?: number | null;
  consensus?: number | null;
  emissionRaw?: number | null;
  lastUpdateAgeBlocks?: number | null;
  immunity?: {
    blocks: number | null;
    registrationBlock: number | null;
    remainingBlocks: number | null;
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** btcli wallet names are filesystem dirs — keep them shell-safe. */
export function sanitizeWalletName(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
  return cleaned.length > 0 ? cleaned : "infranex";
}

export function isValidSs58(hotkey: string | null | undefined): boolean {
  return !!hotkey && SS58_RE.test(hotkey.trim());
}

/** Commands the wizard renders. `netuid: null` disables subnet-specific rows. */
export function cmds(input: {
  walletName: string;
  hotkeyName: string;
  netuid: number | null;
}): Record<string, string | null> {
  const w = sanitizeWalletName(input.walletName);
  const h = sanitizeWalletName(input.hotkeyName);
  const n = input.netuid;
  return {
    install: "pip install bittensor",
    newColdkey: `btcli wallet new_coldkey --wallet_name ${w}`,
    newHotkey: `btcli wallet new_hotkey --wallet_name ${w} --hotkey_name ${h}`,
    overview: `btcli wallet overview --wallet_name ${w}`,
    scp: `scp -r ~/.bittensor/wallets/${w} root@<HOST_IP>:~/.bittensor/wallets/`,
    register:
      n !== null
        ? `btcli subnets register --netuid ${n} --wallet.name ${w} --wallet.hotkey ${h}`
        : null,
    restart:
      n !== null
        ? `ssh root@<HOST_IP> sudo systemctl restart infranex-miner-sn${n}`
        : null,
    metagraph: n !== null ? `btcli subnets metagraph --netuid ${n}` : null,
  };
}

/** Defensive parse of persisted state (localStorage junk, schema drift, …). */
export function normalizeWalletState(raw: unknown): WalletRegistrationState {
  const r = (raw ?? {}) as Partial<WalletRegistrationState>;
  return {
    walletName: sanitizeWalletName(typeof r.walletName === "string" ? r.walletName : "infranex"),
    hotkeyName: sanitizeWalletName(typeof r.hotkeyName === "string" ? r.hotkeyName : "default"),
    netuid: typeof r.netuid === "number" && Number.isInteger(r.netuid) && r.netuid >= 0 ? r.netuid : null,
    hotkeySs58: typeof r.hotkeySs58 === "string" ? r.hotkeySs58 : "",
    doneSteps: Array.isArray(r.doneSteps) ? r.doneSteps.filter((s) => typeof s === "string") : [],
    verifiedUid:
      typeof r.verifiedUid === "number" && Number.isInteger(r.verifiedUid) ? r.verifiedUid : null,
    verifiedAt: typeof r.verifiedAt === "number" ? r.verifiedAt : null,
  };
}

/** Blocks → approximate human hours (1 block ≈ 12 s on Finney). */
export function blocksToHours(blocks: number): number {
  return (blocks * BLOCK_TIME_S) / 3600;
}

// ---------------------------------------------------------------------------
// Persisted store (same pattern as the journey state)
// ---------------------------------------------------------------------------

let cache: { raw: string; val: WalletRegistrationState } | null = null;
let listeners: Array<() => void> = [];

function load(): WalletRegistrationState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? "";
    if (cache && cache.raw === raw) return cache.val;
    const val = normalizeWalletState(raw ? JSON.parse(raw) : null);
    cache = { raw, val };
    return val;
  } catch {
    return DEFAULT_WALLET_STATE;
  }
}

function subscribe(cb: () => void): () => void {
  listeners.push(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
    window.removeEventListener("storage", cb);
  };
}

function emit(): void {
  for (const l of listeners) l();
}

export function saveWalletRegistration(state: WalletRegistrationState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode — wizard just won't persist */
  }
  cache = null;
  emit();
}

/** Reactive wizard state — SSR-safe (server snapshot: defaults). */
export function useWalletRegistration(): WalletRegistrationState {
  return useSyncExternalStore(subscribe, load, () => DEFAULT_WALLET_STATE);
}
