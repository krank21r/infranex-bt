import { db } from "@/lib/db";
import { getUidState } from "./metagraph";
import { commitFinding, autoResolve } from "./triggers-core";
import {
  computeRemainingBlocks,
  formatBlocksLeft,
} from "./immunity";

/**
 * RUNWAY-1 — Immunity Runway. Answers the operator question the point-in-time
 * DEREG_RISK check cannot: "how much runway is LEFT before this UID becomes
 * evictable, and in which direction is it moving?"
 *
 * Three ingredients:
 *   1. Eviction-line margins — distance to each eviction preconditions:
 *      subnet capacity slots, immunity-window blocks left, income vs the
 *      0.0005 incentive floor.
 *   2. Incentive trajectory — least-squares slope over the recent UidSnapshot
 *      history (oldest→newest), normalized by the window's mean level.
 *   3. T-minus — estimated blocks until the eviction line, bounded by the
 *      immunity clock (the hard deadline) and the income decay (slope).
 *
 * Verdicts: safe → watch (warning) → at_risk (critical T-minus) → expired.
 * "expired" is the live EVICTABLE state — DEREG_RISK already owns that alarm,
 * so runway stays quiet there to avoid double-firing the same condition.
 * Deployments without a valid registered hotkey are skipped (no UID, no clock).
 */

const INCOME_FLOOR = 0.0005;

// T-minus bands (blocks; 1 block ≈ 12 s):
const WARN_BLOCKS = 1800; // 6 h — at_risk threshold
const WATCH_BLOCKS = 5400; // 18 h — watch threshold

export type RunwayVerdict = "safe" | "watch" | "at_risk" | "expired";
export type RunwayDirection = "rising" | "stable" | "declining" | "collapsed" | "unknown";

export interface RunwayMargin {
  /** Free capacity slots on the subnet (null = hyperparam unknown). */
  capacityFreeSlots: number | null;
  /** Subnet is at/over maxAllowedUids — the only regime where eviction happens. */
  atCapacity: boolean;
  /** Authoritative immunity clock left (null = registration block not exposed). */
  immunityBlocksLeft: number | null;
  /** Latest incentive (0-1, null = unknown). */
  incentive: number | null;
}

export interface RunwayTrajectory {
  direction: RunwayDirection;
  /** Incentive change per sample (least-squares, normalized by window mean). */
  slopePerSample: number | null;
  /** Samples used for the fit. */
  samples: number;
}

export interface RunwayAssessment {
  verdict: RunwayVerdict;
  margins: RunwayMargin;
  trajectory: RunwayTrajectory;
  /** Estimated blocks until the eviction line (null = no clock / not binding). */
  tMinusBlocks: number | null;
  tMinusLabel: string | null;
  notes: string[];
}

/** Least-squares slope over the incentive series, normalized by its mean. */
export function incentiveSlope(history: (number | null)[]): {
  slopePerSample: number | null;
  samples: number;
} {
  const pts = history.filter((v): v is number => v !== null && Number.isFinite(v));
  if (pts.length < 3) return { slopePerSample: null, samples: pts.length };
  const n = pts.length;
  const meanX = (n - 1) / 2;
  const meanY = pts.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varX = 0;
  for (let i = 0; i < n; i++) {
    cov += (i - meanX) * (pts[i] - meanY);
    varX += (i - meanX) ** 2;
  }
  const raw = varX > 0 ? cov / varX : 0;
  // Normalize by the mean level so the threshold is scale-free.
  const denom = Math.max(Math.abs(meanY), 1e-6);
  return { slopePerSample: raw / denom, samples: n };
}

function directionOf(slope: number | null, incentive: number | null): RunwayDirection {
  if (slope === null) return "unknown";
  if (incentive !== null && incentive <= INCOME_FLOOR) return "collapsed";
  if (slope > 0.02) return "rising";
  if (slope < -0.02) return "declining";
  return "stable";
}

/**
 * Pure runway verdict — unit-tested. `incentiveHistory` is oldest→newest;
 * nulls (unknown samples) are skipped by the fit.
 */
export function computeRunway(input: {
  uid: number | null;
  incentive: number | null;
  incentiveHistory: (number | null)[];
  hyperparams: { immunityPeriod: number | null; maxAllowedUids: number | null };
  registeredUids: number;
  registrationBlock: number | null;
  blockNumber: number | null;
}): RunwayAssessment {
  const notes: string[] = [];

  // --- Margins -------------------------------------------------------------
  const freeSlots =
    input.hyperparams.maxAllowedUids !== null
      ? input.hyperparams.maxAllowedUids - input.registeredUids
      : null;
  const atCapacity =
    input.hyperparams.maxAllowedUids !== null && input.registeredUids >= input.hyperparams.maxAllowedUids;
  const windowBlocks = input.hyperparams.immunityPeriod ?? 0;
  const hasClock =
    input.registrationBlock !== null &&
    input.blockNumber !== null &&
    windowBlocks > 0 &&
    input.uid !== null;
  const immunityLeft = hasClock
    ? computeRemainingBlocks({
        registrationBlock: input.registrationBlock!,
        windowBlocks,
        blockNumber: input.blockNumber!,
      })
    : null;
  const incentive = input.incentive;

  if (!atCapacity) {
    notes.push(
      freeSlots !== null
        ? `Subnet has ${freeSlots} free UID slot${freeSlots === 1 ? "" : "s"} — eviction-for-capacity cannot happen yet.`
        : "Subnet capacity unknown — eviction margin not computable."
    );
  } else {
    notes.push(`Subnet at capacity (${input.registeredUids}/${input.hyperparams.maxAllowedUids}) — only immunity + income protect the UID.`);
  }
  if (immunityLeft !== null) {
    notes.push(
      immunityLeft > 0
        ? `Immunity window: ${formatBlocksLeft(immunityLeft)} of eviction protection left.`
        : "Immunity window expired."
    );
  }

  // --- Trajectory ----------------------------------------------------------
  const { slopePerSample, samples } = incentiveSlope(input.incentiveHistory);
  const direction = directionOf(slopePerSample, incentive);
  if (samples >= 3 && direction === "declining") {
    notes.push(`Incentive declining ≈${(Math.abs(slopePerSample!) * 100).toFixed(1)}%/sample over the last ${samples} samples.`);
  } else if (direction === "collapsed") {
    notes.push("Income collapsed — incentive at/below the 0.05% floor.");
  }

  // --- T-minus -------------------------------------------------------------
  let tMinus: number | null = null;
  if (atCapacity && immunityLeft !== null && incentive !== null) {
    if (immunityLeft === 0 && incentive <= INCOME_FLOOR) {
      tMinus = 0; // standing on the eviction line — DEREG_RISK owns the alarm
    } else if (immunityLeft === 0 && incentive > INCOME_FLOOR) {
      // Immunity expired but the UID EARNS: eviction-for-capacity takes
      // zero-income UIDs, so income protects — no actionable countdown
      // (a declining trend still triggers the watch rule below).
      tMinus = null;
    } else if (incentive <= INCOME_FLOOR) {
      // Zero income NOW: the eviction line arrives exactly at immunity expiry.
      tMinus = immunityLeft;
    } else if (direction === "declining" && slopePerSample !== null && slopePerSample < 0) {
      // Blocks until the decaying incentive crosses the income floor:
      // absolute decay per sample ≈ |slope| × current level, so
      // k ≈ (incentive − floor) / (|slope| × incentive).
      const absSlope = Math.abs(slopePerSample);
      const blocksToFloor =
        absSlope > 1e-9 ? (incentive - INCOME_FLOOR) / Math.max(absSlope * Math.max(incentive, 1e-6), 1e-9) : Infinity;
      // …bounded by the immunity hard deadline.
      tMinus = Math.max(0, Math.min(immunityLeft, Math.floor(blocksToFloor)));
    }
    // Earning + clock still running + stable/rising: margins healthy —
    // tMinus stays null (safe) rather than pretending the clock is a threat.
  }

  // --- Verdict -------------------------------------------------------------
  let verdict: RunwayVerdict = "safe";
  if (atCapacity && immunityLeft === 0 && incentive !== null && incentive <= INCOME_FLOOR) {
    verdict = "expired"; // live EVICTABLE — DEREG_RISK's alarm, runway stays quiet
    notes.push("Actively evictable now — the DEREG_RISK event owns this condition.");
  } else if (tMinus !== null && tMinus <= WARN_BLOCKS) {
    verdict = "at_risk";
    notes.push(`Runway T-minus ${formatBlocksLeft(tMinus)} — act before the window closes.`);
  } else if (tMinus !== null && tMinus <= WATCH_BLOCKS) {
    verdict = "watch";
    notes.push(`Runway T-minus ${formatBlocksLeft(tMinus)} — keep the exit (failover / migration) warm.`);
  } else if (direction === "declining" && incentive !== null && incentive <= 0.005) {
    verdict = "watch";
    notes.push("Income drifting toward the floor while near it — no clock, but the trend is the risk.");
  }

  return {
    verdict,
    margins: {
      capacityFreeSlots: freeSlots,
      atCapacity,
      immunityBlocksLeft: immunityLeft,
      incentive,
    },
    trajectory: { direction, slopePerSample, samples },
    tMinusBlocks: verdict === "expired" ? 0 : tMinus,
    tMinusLabel: tMinus !== null ? formatBlocksLeft(tMinus) : null,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Evaluator — runs inside the devops worker right after uid-defense
// ---------------------------------------------------------------------------

/** SS58 hotkey shape (exported — the monitor payload uses the same gate). */
export const SS58_RE = /^5[1-9A-HJ-NP-Za-km-z]{47}$/;
const TRAJECTORY_WINDOW = 20;

export async function runRunwayPass(): Promise<{
  evaluated: number;
  skipped: number;
  findings: { deploymentId: string; verdict: RunwayVerdict; tMinusBlocks: number | null }[];
}> {
  const deps = await db.deployment.findMany({ where: { status: "started" } });
  const result = {
    evaluated: 0,
    skipped: 0,
    findings: [] as { deploymentId: string; verdict: RunwayVerdict; tMinusBlocks: number | null }[],
  };

  for (const dep of deps) {
    if (!dep.hotkey || !SS58_RE.test(dep.hotkey)) {
      result.skipped++;
      continue; // no valid registered hotkey — nothing to assess on-chain
    }
    try {
      const state = await getUidState(dep.netuid, dep.hotkey);
      const history = await db.uidSnapshot.findMany({
        where: { deploymentId: dep.id },
        orderBy: { createdAt: "desc" },
        take: TRAJECTORY_WINDOW,
      });
      const assessment = computeRunway({
        uid: state.uid,
        incentive: state.uid !== null ? state.vectors?.incentive[state.uid] ?? null : null,
        incentiveHistory: history.slice().reverse().map((h) => h.incentive),
        hyperparams: state.hyperparams,
        registeredUids: state.cohort.registeredUids,
        registrationBlock: state.registrationBlock,
        blockNumber: state.vectors?.blockNumber ?? null,
      });

      const dedupeKey = `${dep.id}:runway`;
      if (assessment.verdict === "watch" || assessment.verdict === "at_risk") {
        const severity = assessment.verdict === "at_risk" ? "critical" : "warning";
        const tLabel = assessment.tMinusLabel ?? "unknown";
        await commitFinding({
          kind: "RUNWAY",
          severity,
          dedupeKey,
          title: `Immunity runway T-minus ${tLabel} on α${dep.netuid} ${dep.subnetName}`,
          detail: assessment.notes.join(" "),
          evidence: {
            verdict: assessment.verdict,
            margins: assessment.margins,
            trajectory: assessment.trajectory,
            tMinusBlocks: assessment.tMinusBlocks,
            tMinusLabel: assessment.tMinusLabel,
            suggestedAction: "failover",
            sampledAt: new Date().toISOString(),
          },
          deploymentId: dep.id,
          netuid: dep.netuid,
          runbook: [
            "Open the Recommendations detail — the runway margins show which precondition closes first (capacity, immunity clock, income).",
            "Approve to fail over: the fallback serving profile is pushed on the GPU and the miner restarts to defend income before expiry.",
            "If income cannot recover before T-minus, migrate the miner to a less saturated subnet (Migrate on the deployment card).",
          ],
        });
        result.findings.push({ deploymentId: dep.id, verdict: assessment.verdict, tMinusBlocks: assessment.tMinusBlocks });
      } else {
        // safe / expired — clear our own open events (expired is DEREG_RISK's).
        await autoResolve("RUNWAY", dedupeKey);
      }
      result.evaluated++;
    } catch (e) {
      // Chain trouble — SKIP (never a false alarm), leave a breadcrumb.
      console.warn(`[runway] skip ${dep.id}: ${e instanceof Error ? e.message : e}`);
      result.skipped++;
    }
  }
  return result;
}
