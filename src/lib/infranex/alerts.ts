import { db } from "@/lib/db";
import { decryptSecret, encryptSecret, secretHint } from "@/lib/devops/crypto";

/**
 * TIER4 — External alerting. Operator-configured webhook channels that
 * receive trigger events the moment they are committed (the commitFinding
 * choke point covers every evaluator: GPU health, UID defense, service
 * health, escalation, upstream drift, benchmarks, runway…).
 *
 * Design rules:
 *   - Fire-and-forget: the dispatcher NEVER throws into the evaluator path —
 *     a broken webhook must not delay or break a monitor pass.
 *   - Severity gate per channel: forward "warning"+ or "critical" only
 *     (info events are digest material, not pages).
 *   - New conditions only: dispatch fires on commitFinding "created", not on
 *     every 90s refresh — a persistent condition pages once, not every pass.
 *   - Secrets: URLs are AES-256-GCM encrypted at rest, never returned to the
 *     client (masked hint only).
 */

export type AlertChannelKind = "generic" | "slack" | "discord";
const CHANNEL_KINDS: AlertChannelKind[] = ["generic", "slack", "discord"];

export function isChannelKind(v: unknown): v is AlertChannelKind {
  return typeof v === "string" && (CHANNEL_KINDS as string[]).includes(v);
}

const RANK: Record<string, number> = { info: 0, warning: 1, critical: 2 };

/**
 * WINDUP-1 — webhook destination policy (defense-in-depth against SSRF).
 * The channel CRUD surface is admin-only, but URLs are still validated at
 * BOTH create/update AND delivery time: absolute http(s) only, and — in
 * production — no loopback/link-local/RFC1918/ULA hosts (webhooks must go
 * out to the real internet). Development allows private hosts so the test
 * suite's local Bun.serve receiver keeps working.
 * Throws with a human-readable message; the API routes surface it as 400.
 */
export function validateWebhookUrl(rawUrl: string): void {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("Webhook URL is not a valid absolute URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Webhook URL must start with http:// or https://");
  }
  if (process.env.NODE_ENV !== "production") return; // dev: local receivers OK

  // URL.hostname keeps IPv6 literals bracketed — strip for uniform checks.
  const host = u.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  const privateHost =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.startsWith("::ffff:127.") ||
    ((host.startsWith("fc") || host.startsWith("fd")) && host.includes(":"));
  if (privateHost) {
    throw new Error("Webhook URL must not point at a private or loopback address");
  }
}

export interface AlertEventInput {
  kind: string;
  severity: string;
  title: string;
  detail: string;
  deploymentId: string | null;
  netuid: number | null;
  createdAt?: Date;
}

/** Build the channel-specific POST body. Pure — unit-tested. */
export function formatAlertBody(
  kind: AlertChannelKind,
  event: AlertEventInput
): { body: string; contentType: string } {
  const sev = event.severity.toUpperCase();
  const scope = event.netuid !== null ? `α${event.netuid}` : "fleet";
  const text = `[INFRANEX ${sev}] ${event.kind} · ${scope}\n${event.title}\n${event.detail.slice(0, 400)}`;
  if (kind === "slack") {
    return { body: JSON.stringify({ text }), contentType: "application/json" };
  }
  if (kind === "discord") {
    return { body: JSON.stringify({ content: text }), contentType: "application/json" };
  }
  return {
    body: JSON.stringify({
      text,
      event: {
        kind: event.kind,
        severity: event.severity,
        title: event.title,
        detail: event.detail,
        deploymentId: event.deploymentId,
        netuid: event.netuid,
        at: (event.createdAt ?? new Date()).toISOString(),
      },
    }),
    contentType: "application/json",
  };
}

type FetchImpl = (
  url: string,
  init: RequestInit
) => Promise<{ ok: boolean; status: number; statusText: string; text: () => Promise<string> }>;
// global fetch's Response structurally satisfies the shape above.
const defaultFetch: FetchImpl = (url, init) => fetch(url, init);

/** Deliver one event to one channel and update the delivery bookkeeping. */
async function deliverToChannel(
  channel: { id: string; name: string; kind: string; urlEnc: string },
  event: AlertEventInput,
  fetchImpl: FetchImpl
): Promise<{ ok: boolean; error?: string }> {
  const url = decryptSecret(channel.urlEnc);
  if (!url) {
    await bookkeep(channel.id, false, "stored webhook URL failed to decrypt");
    return { ok: false, error: "decrypt failed" };
  }
  try {
    validateWebhookUrl(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "webhook URL rejected";
    await bookkeep(channel.id, false, msg);
    return { ok: false, error: msg };
  }
  const fmt = formatAlertBody(isChannelKind(channel.kind) ? channel.kind : "generic", event);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": fmt.contentType },
      body: fmt.body,
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
      redirect: "error", // WINDUP-1: a 302 must not bounce a public URL into an internal one
    });
    if (!res.ok) {
      const t = (await res.text().catch(() => "")).slice(0, 200);
      await bookkeep(channel.id, false, `HTTP ${res.status} ${res.statusText}${t ? `: ${t}` : ""}`);
      return { ok: false, error: `HTTP ${res.status}` };
    }
    await bookkeep(channel.id, true);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown delivery error";
    await bookkeep(channel.id, false, msg);
    return { ok: false, error: msg };
  }
}

async function bookkeep(id: string, ok: boolean, error?: string) {
  try {
    await db.alertChannel.update({
      where: { id },
      data: ok
        ? { lastStatus: "ok", lastError: null, lastSentAt: new Date(), sentCount: { increment: 1 } }
        : { lastStatus: "error", lastError: (error ?? "").slice(0, 200), failCount: { increment: 1 } },
    });
  } catch {
    /* bookkeeping is best-effort */
  }
}

/**
 * Dispatch an event to every enabled channel whose severity gate matches.
 * Never throws — callers may fire-and-forget.
 */
export async function dispatchAlertEvent(
  event: AlertEventInput,
  deps?: { fetchImpl?: FetchImpl; channels?: { id: string; name: string; kind: string; urlEnc: string; minSeverity: string }[] }
): Promise<{ sent: number; failed: number }> {
  const fetchImpl = deps?.fetchImpl ?? defaultFetch;
  try {
    const channels = deps?.channels ?? (await db.alertChannel.findMany({ where: { enabled: true } }));
    const rank = RANK[event.severity] ?? 0;
    const targets = channels.filter((c) => rank >= (RANK[c.minSeverity] ?? 2) && rank > 0);
    let sent = 0;
    let failed = 0;
    for (const ch of targets) {
      const r = await deliverToChannel(ch, event, fetchImpl);
      if (r.ok) sent++;
      else failed++;
    }
    return { sent, failed };
  } catch {
    return { sent: 0, failed: 0 };
  }
}

/** Send a test payload to one channel (returns the delivery verdict). */
export async function testChannel(
  channelId: string,
  deps?: { fetchImpl?: FetchImpl }
): Promise<{ ok: boolean; error?: string }> {
  const ch = await db.alertChannel.findUnique({ where: { id: channelId } });
  if (!ch) throw new Error("Alert channel not found");
  if (!ch.enabled) throw new Error("Channel is disabled — enable it before testing");
  return deliverToChannel(
    { id: ch.id, name: ch.name, kind: ch.kind, urlEnc: ch.urlEnc },
    {
      kind: "TEST",
      severity: "info",
      title: `Alert channel test — "${ch.name}"`,
      detail: "This is a test delivery from the Infranex DevOps Engine. If you can read this, the channel works.",
      deploymentId: null,
      netuid: null,
    },
    deps?.fetchImpl ?? defaultFetch
  );
}

/** Hourly fleet digest to digest-enabled channels (DB-only, cheap). */
export async function runAlertsDigestPass(): Promise<{ sent: number; failed: number; skipped: boolean }> {
  try {
    const [started, openEvents, last24h] = await Promise.all([
      db.deployment.findMany({ where: { status: "started" } }),
      db.triggerEvent.findMany({ where: { status: "open" } }),
      db.triggerEvent.count({
        where: { createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
      }),
    ]);
    const openCritical = openEvents.filter((e) => e.severity === "critical").length;
    const openWarning = openEvents.filter((e) => e.severity === "warning").length;
    const infraPerDay = started.reduce((a, d) => a + d.monthlyCost / 30, 0);
    const revPerDay = started.reduce((a, d) => a + d.estimatedRevenue / 30, 0);
    const text =
      `[INFRANEX DIGEST] ${started.length} miner${started.length === 1 ? "" : "s"} · ` +
      `${openCritical} open critical, ${openWarning} open warning · ${last24h} events/24h · ` +
      `est net $${(revPerDay - infraPerDay).toFixed(2)}/day (rev $${revPerDay.toFixed(2)} − infra $${infraPerDay.toFixed(2)})`;
    const channels = await db.alertChannel.findMany({ where: { enabled: true, digest: true } });
    let sent = 0;
    let failed = 0;
    for (const ch of channels) {
      const r = await deliverToChannel(
        { id: ch.id, name: ch.name, kind: ch.kind, urlEnc: ch.urlEnc },
        { kind: "DIGEST", severity: "info", title: text, detail: "", deploymentId: null, netuid: null },
        defaultFetch
      );
      if (r.ok) sent++;
      else failed++;
    }
    return { sent, failed, skipped: false };
  } catch {
    return { sent: 0, failed: 0, skipped: true };
  }
}

// --- Channel CRUD helpers (used by the API routes) ---------------------------

export async function createChannel(input: {
  name: string;
  kind: AlertChannelKind;
  url: string;
  minSeverity?: string;
  digest?: boolean;
}) {
  const url = input.url.trim();
  // Full destination policy (was: scheme-only regex — WINDUP-1 SSRF hardening).
  validateWebhookUrl(url);
  const row = await db.alertChannel.create({
    data: {
      name: input.name.trim().slice(0, 80),
      kind: input.kind,
      urlEnc: encryptSecret(url),
      minSeverity: input.minSeverity === "warning" ? "warning" : "critical",
      digest: Boolean(input.digest),
    },
  });
  return row;
}

export function channelHint(row: { urlEnc: string }): string {
  return secretHint(decryptSecret(row.urlEnc)) || "—";
}
