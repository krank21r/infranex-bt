import crypto from "crypto";
import { db } from "@/lib/db";

/**
 * TIER1-1 — MinerLog ingest + retention (spec §45 live logs).
 *
 * Two callers:
 *   - /api/daemon/telemetry: real Node Daemon v3 tails report new lines.
 *   - Engine regression suites: simulateMockLogs is a TEST-ONLY harness that
 *     populates log rows for in-process fixture deployments.
 *
 * Dedupe: daemon restarts re-read the file tail, so the same line can arrive
 * twice. lineKey = sha1(deploymentId|at|message) and duplicates are skipped
 * by checking the recent window before insert (SQLite has no skipDuplicates).
 * Retention: keep the newest LOG_RETENTION rows per deployment.
 */

export const LOG_RETENTION = 200;
/** Reject oversized/absurd batches defensively. */
const MAX_BATCH = 120;
const MAX_MSG_CHARS = 300;

export interface RawLogLine {
  at?: unknown;
  severity?: unknown;
  source?: unknown;
  message?: unknown;
}

export interface ParsedLogLine {
  at: Date;
  severity: "info" | "success" | "warning" | "error";
  source: "miner" | "daemon" | "system";
  message: string;
  lineKey: string;
}

const SEVERITIES = new Set(["info", "success", "warning", "error"]);
const SOURCES = new Set(["miner", "daemon", "system"]);

/** Parse + validate one raw daemon line; returns null when unusable. */
export function parseLogLine(deploymentId: string, raw: RawLogLine): ParsedLogLine | null {
  const message = typeof raw.message === "string" ? raw.message.trim().slice(0, MAX_MSG_CHARS) : "";
  if (!message) return null;
  const atMs =
    typeof raw.at === "number" && Number.isFinite(raw.at)
      ? raw.at > 1_000_000_000_000
        ? raw.at // already epoch milliseconds
        : raw.at * 1000 // daemon sends epoch seconds
      : Date.now();
  const at = new Date(Math.min(atMs, Date.now() + 60_000));
  const severity = (typeof raw.severity === "string" && SEVERITIES.has(raw.severity)
    ? raw.severity
    : "info") as ParsedLogLine["severity"];
  const source = (typeof raw.source === "string" && SOURCES.has(raw.source)
    ? raw.source
    : "miner") as ParsedLogLine["source"];
  // lineKey buckets the timestamp to the MINUTE: the same line re-reported
  // within that minute (HTTP retry, daemon restart replaying the tail)
  // dedupes, while a miner legitimately repeating a message in a later
  // minute is still kept.
  const minuteBucket = Math.floor(atMs / 60_000);
  const lineKey = crypto
    .createHash("sha1")
    .update(`${deploymentId}|${minuteBucket}|${message}`)
    .digest("hex");
  return { at, severity, source, message, lineKey };
}

/** Persist a batch of raw lines with dedupe + retention. Returns rows stored. */
export async function ingestMinerLogs(deploymentId: string, lines: RawLogLine[]): Promise<number> {
  const parsed = lines
    .slice(0, MAX_BATCH)
    .map((l) => parseLogLine(deploymentId, l))
    .filter((l): l is ParsedLogLine => l !== null);
  if (parsed.length === 0) return 0;

  // Dedupe against everything stored in the last 12h for this deployment
  // (daemon restarts can replay the tail; older dupes age out anyway).
  const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
  const existing = await db.minerLog.findMany({
    where: { deploymentId, at: { gte: since } },
    select: { lineKey: true },
  });
  const seen = new Set(existing.map((r) => r.lineKey));
  const fresh = parsed.filter((p) => !seen.has(p.lineKey));
  if (fresh.length === 0) return 0;

  await db.minerLog.createMany({
    data: fresh.map((p) => ({
      deploymentId,
      at: p.at,
      severity: p.severity,
      source: p.source,
      message: p.message,
      lineKey: p.lineKey,
    })),
  });

  // Retention — keep the newest LOG_RETENTION rows.
  const stale = await db.minerLog.findMany({
    where: { deploymentId },
    orderBy: { at: "desc" },
    skip: LOG_RETENTION,
    select: { id: true },
  });
  if (stale.length > 0) {
    await db.minerLog.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  }
  return fresh.length;
}

// ---------------------------------------------------------------------------
// Mock simulation — realistic miner chatter for "mock"-tagged deployments.
// Mostly INFO/SUCCESS with the occasional soft WARN (a simulated fleet is
// never sick — that rule is enforced by the health scorer, and log WARNs do
// not feed findings).
// ---------------------------------------------------------------------------

const MOCK_LOG_POOL: { severity: ParsedLogLine["severity"]; message: (n: number) => string }[] = [
  { severity: "info", message: (n) => `syncing metagraph — block ${4_200_000 + (n % 5_000)}` },
  { severity: "info", message: (n) => `forward pass complete in ${140 + (n % 220)}ms` },
  { severity: "success", message: (n) => `served ${18 + (n % 40)} queries in the last window` },
  { severity: "info", message: () => "axon endpoint healthy — priority medium" },
  { severity: "success", message: (n) => `batch ${n % 10_000} scored — priority updated` },
  { severity: "info", message: (n) => `validator handshake ok (${2 + (n % 4)} peers)` },
  { severity: "warning", message: () => "slow query from validator — retrying with backoff" },
  { severity: "info", message: () => "weights loaded from cache" },
  { severity: "success", message: (n) => `heartbeat ${n % 1_000_000} — all systems nominal` },
  { severity: "info", message: (n) => `queue depth ${1 + (n % 6)} — healthy` },
];

/** Insert 1–2 simulated log lines for a mock deployment. Returns rows stored. */
export async function simulateMockLogs(deploymentId: string): Promise<number> {
  const n = Math.floor(Date.now() / 90_000); // deterministic-ish rotation per pass
  const first = MOCK_LOG_POOL[n % MOCK_LOG_POOL.length];
  const second = MOCK_LOG_POOL[(n * 7 + 3) % MOCK_LOG_POOL.length];
  const lines: RawLogLine[] = [
    { at: Date.now() / 1000, severity: first.severity, source: "miner", message: first.message(n) },
  ];
  if (n % 2 === 0) {
    lines.push({ at: Date.now() / 1000 - 20, severity: second.severity, source: "miner", message: second.message(n + 13) });
  }
  return ingestMinerLogs(deploymentId, lines);
}
