import { db } from "@/lib/db";

// WALLET-ECON-1 — append-only audit trail for the actions that matter to a
// production deployment: credential lifecycle (provider keys, host secrets,
// webhook URLs), human approvals of destructive engine proposals, and
// sign-ins. Rows NEVER contain secrets — detail is a hand-built sentence,
// and `meta` is whitelisted scalar data only.
//
// logAudit() never throws: an audit failure must not break the operation it
// is recording (best-effort write, errors logged to the server console).

export interface AuditEntry {
  /** Dot-namespaced action, e.g. "provider-key.saved", "trigger.approved". */
  action: string;
  /** userId of the signed-in operator, or "system" for engine actions. */
  actor?: string;
  /** Identifier of the affected object (provider id, channel id, uid...). */
  target?: string | null;
  /** Human sentence — no secrets. */
  detail?: string;
  /** Whitelisted scalar metadata (never credentials). */
  meta?: Record<string, string | number | boolean | null>;
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action: entry.action,
        actor: entry.actor ?? "system",
        target: entry.target ?? null,
        detail: entry.detail ?? "",
        metaJson: JSON.stringify(entry.meta ?? {}),
      },
    });
  } catch (e) {
    console.error(
      "[audit] write failed",
      entry.action,
      e instanceof Error ? e.message : e
    );
  }
}
