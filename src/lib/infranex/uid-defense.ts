import { db } from "@/lib/db";
import { getUidState } from "./metagraph";
import { commitFinding } from "./triggers-core";
import { syncRegistrationFromUidState } from "./deployment/registration";
import {
  blocksToHoursApprox,
  computeRemainingBlocks,
  type UidImmunityInfo,
} from "./immunity";

/**
 * UID Defense — watches the miner's OWN UID on the metagraph every
 * evaluation pass (~2 min when the UI is open) and fires approval-gated
 * DEREG-RISK defenses when registration or income is at risk.
 *
 * Six risk classes:
 *   NOT_REGISTERED      — hotkey not found in Keys (critical)
 *   ZERO_INCOME         — active but incentive 0 (warning)
 *   EVICTABLE           — subnet at capacity + immunity expired + no income (critical)
 *   UNDERPERFORMING     — incentive < 30% of rewarded median (warning)
 *   INCENTIVE_COLLAPSE  — incentive ≤ 50% of the previous sample (warning)
 *   PERSISTENT_DECLINE  — warning for 3 consecutive samples → critical
 *
 * Immunity clock: when the runtime exposes the registration block, the
 * EVICTABLE check uses the authoritative window (registrationBlock +
 * immunityPeriod − current block); otherwise it falls back to the
 * lastUpdateAge proxy (pre-probe behavior).
 *
 * Infra errors (chain down) SKIP the pass — never a false alarm.
 */

const HISTORY_RETENTION = 120;
const HISTORY_WINDOW = 40;

export type RiskCode =
  | "NOT_REGISTERED"
  | "ZERO_INCOME"
  | "EVICTABLE"
  | "UNDERPERFORMING"
  | "INCENTIVE_COLLAPSE"
  | "PERSISTENT_DECLINE";

export interface UidRiskAssessment {
  riskLevel: "healthy" | "warning" | "critical";
  riskCodes: RiskCode[];
  notes: string[];
}

/** Pure risk assessment — unit-tested. */
export function assessUidRisk(input: {
  uid: number | null;
  active: boolean | null;
  incentive: number | null;
  consensus: number | null;
  /** Blocks since the UID last updated (staleness). */
  lastUpdateAgeBlocks: number | null;
  hyperparams: { tempo: number | null; immunityPeriod: number | null; maxAllowedUids: number | null };
  registeredUids: number;
  /** Median incentive among REWARDED uids (0-1). */
  medianRewardedIncentive: number;
  /** Previous sample's incentive (0-1) for collapse detection. */
  previousIncentive: number | null;
  /** How many consecutive previous samples were warning-level. */
  previousWarningStreak: number;
  /** Block this hotkey registered (authoritative immunity origin), when
   *  the runtime exposes it. Null → fall back to the lastUpdateAge proxy. */
  registrationBlock?: number | null;
  /** Chain block the sample was taken at (ages the registration block). */
  blockNumber?: number | null;
}): UidRiskAssessment {
  const codes: RiskCode[] = [];
  const notes: string[] = [];

  // 1. Not registered at all — the worst case.
  if (input.uid === null) {
    return {
      riskLevel: "critical",
      riskCodes: ["NOT_REGISTERED"],
      notes: ["Hotkey is NOT registered on this subnet — no UID, no income, no protection."],
    };
  }

  const incentive = input.incentive ?? 0;

  // 2. Zero income.
  if (incentive <= 0.0005) {
    codes.push("ZERO_INCOME");
    notes.push(`UID ${input.uid} earned zero incentive this epoch.`);
  }

  // 3. Evictable: subnet at capacity + immunity expired + zero income.
  const atCapacity =
    input.hyperparams.maxAllowedUids !== null && input.registeredUids >= input.hyperparams.maxAllowedUids;
  const immunityBlocks = input.hyperparams.immunityPeriod ?? 0;
  // Authoritative clock when the registration block is exposed; otherwise
  // fall back to the lastUpdateAge proxy (≈ age for stale neurons).
  const hasAuthoritativeClock =
    input.registrationBlock != null && input.blockNumber != null && immunityBlocks > 0;
  const immunityLeft = hasAuthoritativeClock
    ? computeRemainingBlocks({
        registrationBlock: input.registrationBlock!,
        windowBlocks: immunityBlocks,
        blockNumber: input.blockNumber!,
      })
    : null;
  const immunityExpired = hasAuthoritativeClock
    ? immunityLeft! <= 0
    : input.lastUpdateAgeBlocks !== null && immunityBlocks > 0 && input.lastUpdateAgeBlocks > immunityBlocks;
  if (atCapacity && immunityExpired && incentive <= 0.0005) {
    codes.push("EVICTABLE");
    notes.push(
      `Subnet at capacity (${input.registeredUids}/${input.hyperparams.maxAllowedUids}) and immunity expired — UID is a deregistration candidate.`
    );
  }

  // 3b. Zero income while still immune — inform instead of alarm.
  if (codes.includes("ZERO_INCOME") && !immunityExpired && immunityLeft !== null && immunityLeft > 0) {
    notes.push(
      `Still inside its immunity window: ${immunityLeft} blocks (≈${blocksToHoursApprox(immunityLeft).toFixed(1)} h) of eviction protection left${
        atCapacity ? " — the subnet is full, so start earning before it expires." : "."
      }`
    );
  }

  // 4. Underperforming vs the rewarded cohort.
  if (incentive > 0.0005 && input.medianRewardedIncentive > 0 && incentive < input.medianRewardedIncentive * 0.3) {
    codes.push("UNDERPERFORMING");
    notes.push(
      `Incentive ${(incentive * 100).toFixed(2)}% is under 30% of the rewarded median (${(input.medianRewardedIncentive * 100).toFixed(2)}%).`
    );
  }

  // 5. Collapse vs previous sample.
  if (input.previousIncentive !== null && incentive <= input.previousIncentive * 0.5 && input.previousIncentive > 0.0005) {
    codes.push("INCENTIVE_COLLAPSE");
    notes.push(
      `Incentive fell from ${(input.previousIncentive * 100).toFixed(2)}% to ${(incentive * 100).toFixed(2)}% since the last sample.`
    );
  }

  // 6. Persistent decline — warnings compounding.
  if (codes.length > 0 && input.previousWarningStreak >= 2) {
    codes.push("PERSISTENT_DECLINE");
    notes.push(`Warning state held for ${input.previousWarningStreak + 1} consecutive samples.`);
  }

  const riskLevel: UidRiskAssessment["riskLevel"] =
    codes.includes("NOT_REGISTERED") || codes.includes("EVICTABLE") || codes.includes("PERSISTENT_DECLINE")
      ? "critical"
      : codes.length > 0
        ? "warning"
        : "healthy";

  return { riskLevel, riskCodes: codes, notes };
}

// ---------------------------------------------------------------------------
// Evaluator — runs inside the trigger pass
// ---------------------------------------------------------------------------

const SS58_RE = /^5[1-9A-HJ-NP-Za-km-z]{47}$/;

function isValidSs58(hotkey: string | null | undefined): boolean {
  return !!hotkey && SS58_RE.test(hotkey);
}

export async function runUidDefensePass(): Promise<{
  evaluated: number;
  skipped: number;
  findings: { deploymentId: string; riskLevel: string; codes: RiskCode[] }[];
}> {
  const deps = await db.deployment.findMany({ where: { status: "started" } });
  const result = { evaluated: 0, skipped: 0, findings: [] as { deploymentId: string; riskLevel: string; codes: RiskCode[] }[] };

  for (const dep of deps) {
    if (!isValidSs58(dep.hotkey)) {
      result.skipped++;
      continue; // silent skip — mock/invalid hotkeys are not chain entities
    }

    try {
      const state = await getUidState(dep.netuid, dep.hotkey);

      // Previous samples for this deployment (newest first).
      const history = await db.uidSnapshot.findMany({
        where: { deploymentId: dep.id },
        orderBy: { createdAt: "desc" },
        take: HISTORY_RETENTION,
      });
      const previous = history[0] ?? null;
      const prevCodes = previous ? (JSON.parse(previous.riskCodesJson) as RiskCode[]) : [];
      // Streak of consecutive WARNING samples (compounding declines).
      const warningStreak = previous?.riskLevel === "warning" ? countStreak(history) : 0;
      const hadDecline = prevCodes.includes("PERSISTENT_DECLINE");

      const lastUpdateAge =
        state.vectors && state.uid !== null
          ? state.vectors.blockNumber - (state.vectors.lastUpdateBlock[state.uid] ?? state.vectors.blockNumber)
          : null;

      const assessment = assessUidRisk({
        uid: state.uid,
        active: state.uid !== null ? (state.vectors?.active[state.uid] ?? null) : null,
        incentive: state.uid !== null ? (state.vectors?.incentive[state.uid] ?? 0) : null,
        consensus: state.uid !== null ? (state.vectors?.consensus[state.uid] ?? null) : null,
        lastUpdateAgeBlocks: lastUpdateAge,
        hyperparams: state.hyperparams,
        registeredUids: state.cohort.registeredUids,
        medianRewardedIncentive: state.cohort.medianRewardedIncentive,
        previousIncentive: previous?.incentive ?? null,
        previousWarningStreak: hadDecline ? 0 : warningStreak,
        registrationBlock: state.registrationBlock,
        blockNumber: state.vectors?.blockNumber ?? null,
      });

      // Persist sample.
      await db.uidSnapshot.create({
        data: {
          deploymentId: dep.id,
          netuid: dep.netuid,
          uid: state.uid,
          hotkey: dep.hotkey!,
          active: state.uid !== null ? (state.vectors?.active[state.uid] ?? null) : null,
          incentive: state.uid !== null ? (state.vectors?.incentive[state.uid] ?? null) : null,
          consensus: state.uid !== null ? (state.vectors?.consensus[state.uid] ?? null) : null,
          emission: state.uid !== null ? (state.vectors?.emissionRel[state.uid] ?? null) : null,
          validatorTrust: state.uid !== null ? (state.vectors?.validatorTrust[state.uid] ?? null) : null,
          lastUpdate: lastUpdateAge,
          riskLevel: assessment.riskLevel,
          riskCodesJson: JSON.stringify(assessment.riskCodes),
        },
      });
      // Retention: prune beyond 120 rows.
      if (history.length >= HISTORY_RETENTION) {
        const pruneIds = history.slice(HISTORY_RETENTION - 1).map((h) => h.id);
        if (pruneIds.length) {
          await db.uidSnapshot.deleteMany({ where: { id: { in: pruneIds } } });
        }
      }

      // Trigger events.
      if (assessment.riskLevel !== "healthy") {
        const severity = assessment.riskLevel === "critical" ? "critical" : "warning";
        const title =
          assessment.riskCodes.includes("NOT_REGISTERED")
            ? `Registration LOST on α${dep.netuid} ${dep.subnetName}`
            : `Deregistration risk on α${dep.netuid} — ${assessment.riskCodes.join(", ")}`;
        await commitFinding({
          kind: "DEREG_RISK",
          severity,
          dedupeKey: dep.id,
          title,
          detail: assessment.notes.join(" ") || "UID telemetry shows risk.",
          evidence: {
            uid: state.uid,
            netuid: dep.netuid,
            hotkey: dep.hotkey,
            riskCodes: assessment.riskCodes,
            incentive: state.uid !== null ? state.vectors?.incentive[state.uid] ?? null : null,
            cohort: state.cohort,
            immunity: buildImmunityInfo(state),
            sampledAt: new Date().toISOString(),
          },
          deploymentId: dep.id,
          netuid: dep.netuid,
          runbook:
            assessment.riskCodes.includes("NOT_REGISTERED")
              ? [
                  "The hotkey is no longer registered — income is zero until re-registered.",
                  "Re-register on this subnet (burn or recycle), then update the deployment hotkey if changed.",
                  "Approve to restart the miner daemon once re-registered.",
                ]
              : [
                  "Check validator rejections in the miner logs (version, latency, quality).",
                  "Verify the miner process is healthy and serving within deadlines.",
                  "Approve to restart the miner daemon; consider switching subnets if underperformance persists.",
                ],
        });
        result.findings.push({ deploymentId: dep.id, riskLevel: assessment.riskLevel, codes: assessment.riskCodes });
      } else {
        // Recovery — auto-resolve any open DEREG_RISK for this deployment.
        await db.triggerEvent.updateMany({
          where: { kind: "DEREG_RISK", dedupeKey: dep.id, status: "open" },
          data: { status: "resolved", resolvedAt: new Date() },
        });
      }

      result.evaluated++;
    } catch (e) {
      // Infra trouble — SKIP the pass (never a false alarm), leave a breadcrumb.
      console.warn(`[uid-defense] skip ${dep.id}: ${e instanceof Error ? e.message : e}`);
      result.skipped++;
    }
  }

  return result;
}

function countStreak(history: { riskLevel: string }[]): number {
  let streak = 0;
  for (const h of history) {
    if (h.riskLevel === "warning") streak++;
    else break;
  }
  return streak;
}

// ---------------------------------------------------------------------------
// UI payload — latest state + 40-sample history per deployment
// ---------------------------------------------------------------------------

export interface UidDefensePayloadItem {
  deploymentId: string;
  minerName: string;
  netuid: number;
  uid: number | null;
  hotkey: string | null;
  riskLevel: "healthy" | "warning" | "critical";
  riskCodes: string[];
  history: { incentive: number | null; consensus: number | null; at: string }[];
  cohort: { registeredUids: number; earningUids: number; medianRewardedIncentive: number } | null;
  /** Remaining-eviction-protection countdown, when the chain exposes the
   *  registration block. Null when the hotkey is invalid or chain is down. */
  immunity: UidImmunityInfo | null;
  note?: string;
}

export async function getUidDefensePayload(): Promise<UidDefensePayloadItem[]> {
  const deps = await db.deployment.findMany({
    where: { status: "started" },
    orderBy: { createdAt: "desc" },
  });
  const buildUidState = async (
    dep: (typeof deps)[number]
  ): Promise<UidDefensePayloadItem> => {
    const history = await db.uidSnapshot.findMany({
      where: { deploymentId: dep.id },
      orderBy: { createdAt: "desc" },
      take: HISTORY_WINDOW,
    });
    const latest = history[0];
    // Fresh chain state (vectors are 60s-cached per netuid) — gives the live
    // uid, cohort AND the immunity clock in one call when a hotkey is set.
    const hk = dep.hotkey;
    const full = hk && isValidSs58(hk) ? await getUidState(dep.netuid, hk).catch(() => null) : null;
    // Phase 2 auto-detect: this scan already knows whether the hotkey is
    // registered — let the deployment record catch up for free.
    if (full) {
      await syncRegistrationFromUidState(dep, full).catch(() => {});
    }
    return {
      deploymentId: dep.id,
      minerName: dep.minerName,
      netuid: dep.netuid,
      uid: full ? full.uid : (latest?.uid ?? null),
      hotkey: dep.hotkey,
      riskLevel: (latest?.riskLevel ?? "healthy") as "healthy" | "warning" | "critical",
      riskCodes: latest ? (JSON.parse(latest.riskCodesJson) as string[]) : [],
      history: history
        .slice()
        .reverse()
        .map((h) => ({ incentive: h.incentive, consensus: h.consensus, at: h.createdAt.toISOString() })),
      cohort:
        full?.uid != null
          ? full.cohort
          : latest?.incentive != null && dep.hotkey
            ? await cohortFor(dep.netuid).catch(() => null)
            : null,
      immunity: full ? buildImmunityInfo(full) : null,
      note: !isValidSs58(dep.hotkey)
        ? "No valid hotkey set on this deployment — UID telemetry unavailable."
        : undefined,
    };
  };
  const out: UidDefensePayloadItem[] = [];
  for (const dep of deps) {
    out.push(await buildUidState(dep));
  }
  return out;
}

async function cohortFor(netuid: number) {
  const state = await getUidState(netuid);
  return state.cohort;
}

/** Project a metagraph state into the UI-facing immunity countdown. */
function buildImmunityInfo(
  state: Awaited<ReturnType<typeof getUidState>>
): UidImmunityInfo {
  const windowBlocks = state.hyperparams.immunityPeriod;
  const registrationBlock = state.uid !== null ? state.registrationBlock : null;
  const blockNumber = state.vectors?.blockNumber ?? null;
  const remainingBlocks =
    state.uid !== null && windowBlocks !== null && registrationBlock !== null && blockNumber !== null
      ? computeRemainingBlocks({ registrationBlock, windowBlocks, blockNumber })
      : null;
  return {
    windowBlocks,
    registrationBlock,
    remainingBlocks,
    blockNumber,
    sampledAt: Date.now(),
  };
}
