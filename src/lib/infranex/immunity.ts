/**
 * Immunity window math — shared by the Wallet & Registration wizard, the
 * UID Defense payload (server) and the UID Defense panel (client tick).
 *
 * Pure module: no server deps (db/chain), no react — safe to import from
 * server routes, client components and bun test scripts alike.
 *
 * Mechanics (Bittensor): a subnet's immunity window (e.g. KubeTEE α90:
 * 5,000 blocks ≈ 16.7 h) starts at the block the registration transaction
 * confirms — the UID assignment block — NOT when setup finishes. While a
 * UID is immune it cannot be deregistered for performance reasons, even
 * when the subnet is full. Re-registering resets the clock.
 */

export const BLOCK_SECONDS = 12; // Finney average block time

export interface UidImmunityInfo {
  /** Subnet immunity window length in blocks (null = hyperparam unknown). */
  windowBlocks: number | null;
  /** Block this hotkey registered — the immunity clock origin. Null when
   *  unregistered or the runtime doesn't expose the storage. */
  registrationBlock: number | null;
  /** Blocks of eviction protection left: registrationBlock + window −
   *  current block. 0 = expired, null = no authoritative clock. */
  remainingBlocks: number | null;
  /** Chain block the snapshot was computed at. */
  blockNumber: number | null;
  /** Wall-clock anchor (ms epoch) so clients can tick the countdown
   *  between polls (server polls every ~45 s, blocks every ~12 s). */
  sampledAt: number;
}

/** Remaining immunity, given the authoritative on-chain clock. */
export function computeRemainingBlocks(input: {
  registrationBlock: number;
  windowBlocks: number;
  blockNumber: number;
}): number {
  return Math.max(0, input.registrationBlock + input.windowBlocks - input.blockNumber);
}

/** Client tick: age the server snapshot between polls (1 block ≈ 12 s). */
export function tickRemainingBlocks(
  immunity: Pick<UidImmunityInfo, "remainingBlocks" | "sampledAt">
): number | null {
  if (immunity.remainingBlocks === null) return null;
  const elapsedBlocks = Math.max(
    0,
    Math.floor((Date.now() - immunity.sampledAt) / (BLOCK_SECONDS * 1000))
  );
  return Math.max(0, immunity.remainingBlocks - elapsedBlocks);
}

/** Compact "16h 40m" / "42m 10s" / "8s" rendering of a block count. */
export function formatBlocksLeft(blocks: number): string {
  const totalS = Math.max(0, Math.round(blocks * BLOCK_SECONDS));
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Approximate hours for a block count (tooltips / subtext). */
export function blocksToHoursApprox(blocks: number): number {
  return (blocks * BLOCK_SECONDS) / 3600;
}
