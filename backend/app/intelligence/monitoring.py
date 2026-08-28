"""
Monitoring + rewards engine (Phase 9).

Pure-Python, deterministic monitor that answers one question:

    "Given recent emission observations for a deployed subnet, should
     the operator migrate off it?"

Phase 9 scope (min-viable, per user decision):
  - `record_emission(block, netuid, tao_per_block) -> dict`
    Pure formatter for one (block, subnet, per-block-TAO) row.
  - `compute_rolling_roi(observations, monthly_cost_usd, tao_price_usd)
        -> RollingROI`
    Trailing-window ROI over the observation list. Median, not mean,
    so 1-2 spike blocks don't poison the signal.
  - `should_migrate(observations, monthly_cost_usd, tao_price_usd, *,
                    min_observations=MIN_OBSERVATIONS) -> MigrateSignal`
    True when the rolling ROI is negative AND the sample size has
    crossed the `min_observations` floor. The floor is the most
    important invariant — without it, a freshly-deployed miner would
    migrate on its first empty block.

Per-block cadence is the user-chosen default. The pure layer is
cadence-agnostic — it just consumes a list of observations; the
service layer (or the future scheduler) decides when to push more.

NOT in scope (deferred):
  - No live scheduler / cron. The pure layer is callable; the loop
    is a separate concern.
  - No `MigrateSignal` DB row. `should_migrate` returns an in-memory
    signal only — the audit trail and the wiring into the approval
    flow are future passes.
  - No notification / webhook.
  - No multi-window analysis (e.g. "1h AND 24h both negative"). One
    rolling window is enough to start.
"""
from dataclasses import dataclass
from statistics import median
from typing import Any, Dict, List, Optional, Sequence, Tuple


# Default model version. Bump on any change to the migrate rule.
MONITOR_MODEL_VERSION = "v1.0"

# Floor below which `should_migrate` returns False regardless of ROI.
# Chosen to suppress startup noise (a freshly-provisioned miner will
# have a handful of "no emissions yet" rows before the first payout).
DEFAULT_MIN_OBSERVATIONS = 10

# Window size for the rolling median. ~7200 blocks ≈ 24h on a 12s block.
DEFAULT_ROLLING_WINDOW = 7200

# Blocks per month — kept in sync with profitability.py.
BLOCKS_PER_MONTH = 30_000


# ---------- dataclasses ----------


@dataclass(frozen=True)
class RollingROI:
    """Result of `compute_rolling_roi`."""
    rolling_roi: Optional[float]   # median(profit / cost) over the window
    sample_size: int
    is_negative: bool              # True iff rolling_roi < 0 and sample_size > 0
    monthly_revenue_usd: float     # median revenue across the window
    monthly_cost_usd: float        # passthrough
    model_version: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "rolling_roi": self.rolling_roi,
            "sample_size": self.sample_size,
            "is_negative": self.is_negative,
            "monthly_revenue_usd": self.monthly_revenue_usd,
            "monthly_cost_usd": self.monthly_cost_usd,
            "model_version": self.model_version,
        }


@dataclass(frozen=True)
class MigrateSignal:
    """Result of `should_migrate`. Read-only signal, no side effects."""
    should_migrate: bool
    reason: str
    rolling_roi: Optional[float]
    sample_size: int
    model_version: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "should_migrate": self.should_migrate,
            "reason": self.reason,
            "rolling_roi": self.rolling_roi,
            "sample_size": self.sample_size,
            "model_version": self.model_version,
        }


# ---------- record_emission ----------


def record_emission(
    block: int,
    netuid: int,
    tao_per_block: float,
) -> Dict[str, Any]:
    """Format one (block, subnet, per-block-TAO) snapshot.

    Pure formatter — no DB, no time. The service layer (or the
    future scanner) hands the result to the persistence path.
    """
    return {
        "block": int(block),
        "netuid": int(netuid),
        "tao_per_block": float(tao_per_block),
    }


# ---------- compute_rolling_roi ----------


def _per_observation_revenue(tao_per_block: float, tao_price_usd: float) -> float:
    """Per-block TAO × blocks-per-month × USD/TAO = projected monthly revenue."""
    return float(tao_per_block) * BLOCKS_PER_MONTH * float(tao_price_usd)


def compute_rolling_roi(
    observations: Sequence[Tuple[int, float]],
    monthly_cost_usd: float,
    tao_price_usd: float,
    *,
    window: int = DEFAULT_ROLLING_WINDOW,
) -> RollingROI:
    """Compute rolling-window ROI from a stream of (block, tao_per_block).

    Uses the median of per-observation ROIs over the most recent
    `window` entries. Robust to short bursts; tolerates 1-2 spike
    blocks without flipping the signal.

    Args:
        observations: any iterable of (block_number, tao_per_block) pairs.
            Order is not enforced; we take the trailing `window`.
        monthly_cost_usd: passthrough from the Deployment row.
        tao_price_usd: USD per TAO at monitor time.
        window: trailing-window size (default 7200).

    Returns:
        RollingROI. `rolling_roi` is None when cost is 0 (cannot divide)
        OR the observation list is empty.
    """
    cost = float(monthly_cost_usd or 0.0)
    # Take the trailing window. Observations is a sequence so we slice.
    tail = list(observations)[-window:] if observations else []
    sample_size = len(tail)

    if cost <= 0 or sample_size == 0:
        return RollingROI(
            rolling_roi=None,
            sample_size=sample_size,
            is_negative=False,
            monthly_revenue_usd=0.0,
            monthly_cost_usd=round(cost, 2),
            model_version=MONITOR_MODEL_VERSION,
        )

    revenues = [
        _per_observation_revenue(tao_per_block, tao_price_usd)
        for _, tao_per_block in tail
    ]
    rois = [(rev - cost) / cost for rev in revenues]
    med = float(median(rois))
    median_revenue = float(median(revenues))

    return RollingROI(
        rolling_roi=round(med, 4),
        sample_size=sample_size,
        is_negative=med < 0,
        monthly_revenue_usd=round(median_revenue, 2),
        monthly_cost_usd=round(cost, 2),
        model_version=MONITOR_MODEL_VERSION,
    )


# ---------- should_migrate ----------


def should_migrate(
    observations: Sequence[Tuple[int, float]],
    monthly_cost_usd: float,
    tao_price_usd: float,
    *,
    min_observations: int = DEFAULT_MIN_OBSERVATIONS,
    window: int = DEFAULT_ROLLING_WINDOW,
) -> MigrateSignal:
    """Decide whether the operator should migrate off the deployed subnet.

    Returns True iff BOTH conditions hold:
      1. The rolling ROI is strictly negative.
      2. The sample size has crossed `min_observations`
         (suppresses startup noise).

    Returns False (with a descriptive `reason`) otherwise. The
    `reason` field is what the dashboard renders — it should be
    human-readable without further unpacking.
    """
    rolling = compute_rolling_roi(
        observations, monthly_cost_usd, tao_price_usd, window=window
    )

    if rolling.sample_size < min_observations:
        return MigrateSignal(
            should_migrate=False,
            reason=(
                f"insufficient data: {rolling.sample_size} < "
                f"{min_observations} min_observations"
            ),
            rolling_roi=rolling.rolling_roi,
            sample_size=rolling.sample_size,
            model_version=MONITOR_MODEL_VERSION,
        )

    if rolling.rolling_roi is None:
        return MigrateSignal(
            should_migrate=False,
            reason="monthly_cost is zero; ROI undefined",
            rolling_roi=None,
            sample_size=rolling.sample_size,
            model_version=MONITOR_MODEL_VERSION,
        )

    if rolling.is_negative:
        return MigrateSignal(
            should_migrate=True,
            reason=(
                f"rolling ROI negative: {rolling.rolling_roi:.4f} "
                f"over {rolling.sample_size} observations"
            ),
            rolling_roi=rolling.rolling_roi,
            sample_size=rolling.sample_size,
            model_version=MONITOR_MODEL_VERSION,
        )

    return MigrateSignal(
        should_migrate=False,
        reason=(
            f"rolling ROI non-negative: {rolling.rolling_roi:.4f} "
            f"over {rolling.sample_size} observations"
        ),
        rolling_roi=rolling.rolling_roi,
        sample_size=rolling.sample_size,
        model_version=MONITOR_MODEL_VERSION,
    )
