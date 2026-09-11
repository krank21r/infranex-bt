import type { JudgeCohort } from "./types";

/**
 * Cohort builder — turns raw on-chain incentive vectors into a "how brutal
 * is this judge" assessment.
 *
 * Brutality answers the question every miner cares about: if I register here,
 * how likely am I to actually EARN? A subnet with 256 registered UIDs where
 * 3 earn is a shark tank no matter how good the code looks.
 *
 * Pure function — unit-tested, no I/O.
 */

export interface CohortInputs {
  registeredUids: number;
  /** Per-UID incentive values (u16-normalized 0-1), one per registered uid. */
  incentives: number[];
}

/** Brutality formula constants (tuned on live cohorts — see worklog). */
const BRUTALITY_BASE = 10;
const EARNING_WEIGHT = 55;
const CONCENTRATION_WEIGHT = 15;
/** An earning ratio at/above this is considered healthy (component → 0). */
const HEALTHY_EARNING_RATIO = 0.5;

export function buildCohort({ registeredUids, incentives }: CohortInputs): JudgeCohort {
  // No cohort data → neutral brutality, "moderate" band. We refuse to
  // pretend an unknown cohort is friendly.
  if (registeredUids <= 0) {
    return {
      registeredUids: 0,
      earningUids: 0,
      earningRatio: 0,
      medianIncentive: 0,
      meanIncentive: 0,
      top10Take: 0,
      brutality: 50,
      band: "moderate",
    };
  }

  const inc = incentives.filter((v) => Number.isFinite(v) && v >= 0);
  const earning = inc.filter((v) => v > 0.0005);
  const earningUids = earning.length;
  const earningRatio = registeredUids > 0 ? earningUids / registeredUids : 0;

  const sorted = [...earning].sort((a, b) => a - b);
  const medianIncentive = sorted.length
    ? sorted[Math.floor(sorted.length / 2)]
    : 0;
  const meanIncentive = inc.length
    ? inc.reduce((a, b) => a + b, 0) / inc.length
    : 0;

  // Top-10% concentration: share of total earned incentive captured by the
  // top 10% of earning uids (1.0 = whale-take-all).
  let top10Take = 0;
  if (earningUids > 0) {
    const total = earning.reduce((a, b) => a + b, 0);
    const topCount = Math.max(1, Math.ceil(earningUids * 0.1));
    const topSum = sorted.slice(-topCount).reduce((a, b) => a + b, 0);
    top10Take = total > 0 ? Math.min(1, topSum / total) : 0;
  }

  const brutality = clampBrutality(
    BRUTALITY_BASE +
      EARNING_WEIGHT * (1 - Math.min(1, earningRatio / HEALTHY_EARNING_RATIO)) +
      CONCENTRATION_WEIGHT * top10Take
  );

  return {
    registeredUids,
    earningUids,
    earningRatio,
    medianIncentive,
    meanIncentive,
    top10Take,
    brutality,
    band: brutalityBand(brutality),
  };
}

function clampBrutality(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function brutalityBand(brutality: number): JudgeCohort["band"] {
  if (brutality < 35) return "forgiving";
  if (brutality < 55) return "moderate";
  if (brutality < 70) return "brutal";
  return "shark_tank";
}
