// ---------------------------------------------------------------------------
// Registration-aware deployments (Phase 2).
//
// The miner runs BEFORE its hotkey is registered — registration is the LAST
// step of the journey (it starts the immunity clock, so it must not happen
// early). That leaves the deployment record blind about the most important
// on-chain fact: is this miner actually registered, and since which block?
//
// This module closes the loop:
//
//   checkRegistration(id)      — chain check via getUidState (throttled to
//                                one scan per 30 s unless forced) and the
//                                record transition unregistered → registered
//                                (uid + registration block) — or the honest
//                                downgrade registered → unregistered when a
//                                full metagraph scan proves the UID is gone.
//   attachHotkey(id, hotkey)   — bind a (freshly wizard-created) hotkey to
//                                the deployment, then force a check.
//   restartAfterRegistration(id)— approval-gated miner restart (the user's
//                                click IS the approval) so the axon
//                                re-announces for the new UID. venv path:
//                                systemctl restart; docker path: docker
//                                restart of infranex-miner-sn<netuid>.
//   syncRegistrationFromUidState — background auto-detect: the UID Defense
//                                payload builder already scans the metagraph
//                                for every started deployment; this piggy-
//                                backs on it so registrations surface even
//                                when the user never presses anything.
//
// Safety rules:
//   • infra errors NEVER flip the state (chain down ≠ deregistered);
//   • a downgrade requires a scan of a non-empty metagraph (registeredUids>0)
//     — an empty subnet read is inconclusive, not proof of deregistration;
//   • the restart is always explicit (approval), never automatic.
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { getUidState } from "../metagraph";
import { mirrorStepOutput, transportFor } from "./real-setup";
import { decodeAddress } from "@polkadot/util-crypto";

export type RegistrationState = "unregistered" | "registered";

const CHECK_THROTTLE_MS = 30_000;
const SS58_RE = /^5[1-9A-HJ-NP-Za-km-z]{47}$/;

export function isValidSs58(hotkey: string | null | undefined): boolean {
  return !!hotkey && SS58_RE.test(hotkey.trim());
}

/**
 * Shape-valid AND checksum-decodable — a regex-passing but checksum-invalid
 * address would otherwise explode inside the chain scan and masquerade as
 * "chain unreachable".
 */
export function isDecodableSs58(hotkey: string | null | undefined): boolean {
  if (!isValidSs58(hotkey)) return false;
  try {
    decodeAddress(hotkey!.trim());
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Pure transition decision — unit-tested, no I/O.
// ---------------------------------------------------------------------------

export function decideRegistrationTransition(input: {
  currentState: RegistrationState | null;
  /** UID the hotkey occupies (null = not found in the Keys scan). */
  uid: number | null;
  /** How many UIDs the scan actually saw (0 = empty/inconclusive metagraph). */
  metagraphSize: number;
  /** True when the chain read itself failed (infra error). */
  chainError: boolean;
}): { to: RegistrationState | "unknown"; reason: string } {
  if (input.chainError) {
    return { to: "unknown", reason: "chain read failed — state unchanged (never flip on infra errors)" };
  }
  if (input.uid !== null) {
    return {
      to: "registered",
      reason: `hotkey found in the metagraph scan (uid ${input.uid})`,
    };
  }
  if (input.metagraphSize <= 0) {
    return { to: "unknown", reason: "metagraph read was empty — inconclusive, state unchanged" };
  }
  return {
    to: "unregistered",
    reason: `hotkey not among the ${input.metagraphSize} registered UIDs — definitive scan`,
  };
}

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface RegistrationCheckResult {
  deploymentId: string;
  state: RegistrationState | "unknown";
  uid: number | null;
  registrationBlock: number | null;
  /** Chain block the sample was taken at (immunity clock reference). */
  blockNumber: number | null;
  immunityWindowBlocks: number | null;
  checkedAt: string;
  /** True when this check flipped the persisted state. */
  changed: boolean;
  /** Human note when the check could not conclude. */
  note: string | null;
}

function snapshotOf(
  id: string,
  row: {
    registrationState: string | null;
    registeredUid: number | null;
    registrationBlock: number | null;
    registrationCheckedAt: Date | null;
  },
  extra: Partial<RegistrationCheckResult> = {}
): RegistrationCheckResult {
  return {
    deploymentId: id,
    state: (row.registrationState as RegistrationState | null) ?? "unknown",
    uid: row.registeredUid,
    registrationBlock: row.registrationBlock,
    blockNumber: null,
    immunityWindowBlocks: null,
    checkedAt: (row.registrationCheckedAt ?? new Date()).toISOString(),
    changed: false,
    note: null,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Chain check
// ---------------------------------------------------------------------------

/**
 * Check the deployment's hotkey against the live metagraph and persist the
 * transition. Throttled to one chain scan per 30 s unless `force`.
 */
export async function checkRegistration(
  id: string,
  opts: { force?: boolean } = {}
): Promise<RegistrationCheckResult> {
  const row = await db.deployment.findUnique({ where: { id } });
  if (!row) throw new Error("Deployment not found");

  if (row.status !== "started") {
    return snapshotOf(id, row, { note: "deployment is not started yet — registration is checked once the miner runs" });
  }
  if (!isValidSs58(row.hotkey)) {
    return snapshotOf(id, row, {
      note: "no valid hotkey attached — create one with the Connect & register wizard, then attach it here",
    });
  }
  if (!isDecodableSs58(row.hotkey)) {
    return snapshotOf(id, row, {
      note: "attached hotkey is malformed (checksum) — re-attach a valid SS58 from the wizard",
    });
  }
  if (
    !opts.force &&
    row.registrationCheckedAt &&
    Date.now() - row.registrationCheckedAt.getTime() < CHECK_THROTTLE_MS
  ) {
    return snapshotOf(id, row, { note: "checked recently — throttled (use Verify now to force)" });
  }

  let state: Awaited<ReturnType<typeof getUidState>> | null = null;
  let chainError = false;
  try {
    state = await getUidState(row.netuid, row.hotkey!.trim());
  } catch {
    chainError = true;
  }

  const markedAt = new Date();
  if (chainError || !state) {
    await db.deployment.update({
      where: { id },
      data: { registrationCheckedAt: markedAt },
    });
    return snapshotOf(id, row, {
      checkedAt: markedAt.toISOString(),
      note: "chain unreachable — state unchanged (never flip on infra errors)",
    });
  }

  const decision = decideRegistrationTransition({
    currentState: (row.registrationState as RegistrationState | null) ?? null,
    uid: state.uid,
    metagraphSize: state.cohort.registeredUids,
    chainError: false,
  });
  const next = decision.to;
  const changed = next !== "unknown" && next !== row.registrationState;

  if (changed) {
    await db.deployment.update({
      where: { id },
      data: {
        registrationState: next,
        registeredUid: next === "registered" ? state.uid : null,
        registrationBlock: next === "registered" ? state.registrationBlock : null,
        registrationCheckedAt: markedAt,
      },
    });
    await mirrorTransition(id, next, state.uid, state.registrationBlock, state.cohort.registeredUids);
  } else {
    // No transition — still refresh the registration block when the chain
    // exposes a different one (e.g. re-registration recycled the UID).
    const blockChanged =
      next === "registered" &&
      state.registrationBlock !== null &&
      state.registrationBlock !== row.registrationBlock;
    await db.deployment.update({
      where: { id },
      data: {
        registrationCheckedAt: markedAt,
        ...(blockChanged ? { registrationBlock: state.registrationBlock } : {}),
      },
    });
    if (blockChanged) {
      await mirrorStepOutput(id, "health", [
        `[registration] registration block moved to #${state.registrationBlock} — the UID was re-registered (immunity window restarted)`,
      ]);
    }
  }

  return {
    deploymentId: id,
    state: next,
    uid: state.uid,
    registrationBlock: state.registrationBlock,
    blockNumber: state.vectors?.blockNumber ?? null,
    immunityWindowBlocks: state.hyperparams.immunityPeriod ?? null,
    checkedAt: markedAt.toISOString(),
    changed,
    note: changed ? null : decision.reason,
  };
}

/** Mirror a state transition into the deployment's health step log. */
async function mirrorTransition(
  id: string,
  next: RegistrationState,
  uid: number | null,
  registrationBlock: number | null,
  metagraphSize: number
): Promise<void> {
  if (next === "registered") {
    await mirrorStepOutput(id, "health", [
      `[registration] hotkey IS registered on-chain — UID ${uid}${registrationBlock !== null ? ` at block #${registrationBlock}` : ""}`,
      "[registration] the immunity window started at the registration block — live countdown in UID Defense",
    ]);
  } else {
    await mirrorStepOutput(id, "health", [
      `[registration] hotkey is NOT registered (scanned ${metagraphSize} UIDs) — no UID, no income, no protection`,
      "[registration] run the Connect & register wizard (register = step 6), then press Verify now",
    ]);
  }
}

// ---------------------------------------------------------------------------
// Attach hotkey (wizard hand-off)
// ---------------------------------------------------------------------------

/**
 * Bind a hotkey SS58 to the deployment and reset the registration lifecycle
 * so the next check re-derives everything from chain. Returns the check.
 */
export async function attachHotkey(id: string, hotkeyRaw: string): Promise<RegistrationCheckResult> {
  const row = await db.deployment.findUnique({ where: { id } });
  if (!row) throw new Error("Deployment not found");
  const hotkey = hotkeyRaw.trim();
  if (!isDecodableSs58(hotkey)) {
    throw new Error(
      "Not a valid hotkey SS58 address (48 characters, starts with '5', valid checksum)"
    );
  }
  await db.deployment.update({
    where: { id },
    data: {
      hotkey,
      registrationState: null,
      registeredUid: null,
      registrationBlock: null,
      registrationCheckedAt: null,
      restartedAfterRegistration: false,
    },
  });
  await mirrorStepOutput(id, "health", [
    `[registration] hotkey attached${row.hotkey && row.hotkey !== hotkey ? " (replaced the previous one)" : ""} — checking the chain…`,
  ]);
  return checkRegistration(id, { force: true });
}

// ---------------------------------------------------------------------------
// Approval restart (after registration)
// ---------------------------------------------------------------------------

/**
 * Restart the miner so it re-announces its axon for the (new) UID. The
 * caller's explicit action IS the approval — nothing here runs on a timer.
 * venv path → systemctl restart; docker path → docker restart of the
 * infranex-miner-sn<netuid> container.
 */
export async function restartAfterRegistration(id: string): Promise<{ ok: boolean; output: string[] }> {
  const row = await db.deployment.findUnique({ where: { id } });
  if (!row) throw new Error("Deployment not found");
  if (row.status !== "started") {
    throw new Error("Miner must be started before the restart (registration follows deployment)");
  }
  if (row.registrationState !== "registered") {
    throw new Error("Miner is not marked registered yet — run Verify now after the register transaction");
  }
  if (row.restartedAfterRegistration) {
    return { ok: true, output: ["[restart] already restarted after registration — nothing to do"] };
  }

  const netuid = row.netuid;
  const unit = `infranex-miner-sn${netuid}`;
  const profile = row.requirementsJsonSnapshot
    ? (JSON.parse(row.requirementsJsonSnapshot) as { dockerfileFound?: boolean; dockerImage?: string | null })
    : null;
  const dockerPath = !!profile?.dockerfileFound && !!profile?.dockerImage;

  const lines: string[] = [
    `[restart] approval received — restarting the miner so it re-announces its axon for UID ${row.registeredUid ?? "?"}`,
    `[restart] $ ${dockerPath ? `docker restart ${unit}` : `systemctl restart ${unit}`}`,
  ];
  let transport: Awaited<ReturnType<typeof transportFor>> | null = null;
  try {
    transport = await transportFor(id);
    const r = await transport.exec(
      dockerPath ? `docker restart ${unit}` : `systemctl restart ${unit}`,
      60_000
    );
    if (r.stdout.trim()) lines.push(...r.stdout.trim().split("\n").slice(0, 4));
    if (r.stderr.trim()) lines.push(...r.stderr.trim().split("\n").slice(0, 4));
    if (r.code !== 0) {
      lines.push(`[restart] restart command failed (exit ${r.code}) — fix on the host, then press Restart again`);
      await mirrorStepOutput(id, "health", lines);
      return { ok: false, output: lines };
    }
    // Verify the process came back.
    const verify = await transport.exec(
      dockerPath ? `docker ps --filter name=${unit} --format '{{.Names}} {{.Status}}'` : `systemctl is-active ${unit}`,
      30_000
    );
    const vout = verify.stdout.trim() || verify.stderr.trim();
    lines.push(`[restart] verify: ${vout || "(no output)"} — axon re-announced on-chain at startup`);
  } catch (e) {
    lines.push(`[restart] transport error: ${e instanceof Error ? e.message : e}`);
    await mirrorStepOutput(id, "health", lines);
    return { ok: false, output: lines };
  } finally {
    transport?.close();
  }

  await db.deployment.update({ where: { id }, data: { restartedAfterRegistration: true } });
  await mirrorStepOutput(id, "health", lines);
  return { ok: true, output: lines };
}

// ---------------------------------------------------------------------------
// Background sync (piggybacks on the UID Defense payload build)
// ---------------------------------------------------------------------------

/**
 * Auto-detect a registration that happened outside the explicit check flow.
 * Called from getUidDefensePayload — it already runs getUidState for every
 * started deployment with a valid hotkey, so this costs zero extra chain
 * calls. One-directional on purpose: it only ever marks REGISTERED (the
 * downgrade path needs a deliberate, forced check).
 */
export async function syncRegistrationFromUidState(
  dep: { id: string; registrationState: string | null; registeredUid: number | null; registrationBlock: number | null },
  state: { uid: number | null; registrationBlock: number | null }
): Promise<void> {
  if (state.uid === null) return;
  if (dep.registrationState === "registered" && dep.registeredUid === state.uid) {
    // Already correct — refresh the registration block if it moved (re-reg).
    if (state.registrationBlock !== null && state.registrationBlock !== dep.registrationBlock) {
      await db.deployment.update({
        where: { id: dep.id },
        data: { registrationBlock: state.registrationBlock },
      });
    }
    return;
  }
  await db.deployment.update({
    where: { id: dep.id },
    data: {
      registrationState: "registered",
      registeredUid: state.uid,
      registrationBlock: state.registrationBlock,
      registrationCheckedAt: new Date(),
    },
  });
  await mirrorTransition(dep.id, "registered", state.uid, state.registrationBlock, 0);
}
