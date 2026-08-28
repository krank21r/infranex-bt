"""
Profitability engine (Phase 8).

Pure-Python, deterministic projection layer that takes a subnet's
recent emission history + a TAO/USD price and returns:

  - monthly_revenue_usd:  trailing-average emission × blocks/month × TAO price
  - confidence:           how much history we have, [0.0, 1.0]
  - monthly_cost_usd:     passthrough from `Deployment.estimated_monthly_cost`
  - monthly_profit_usd:   revenue - cost (None if cost is 0)
  - roi:                  profit / cost  (None if cost is 0)
  - model_version:        "v1.0" (bump on any formula change)

All inputs are explicit — no DB, no env, no live price feed. The
service layer (`ProfitabilityService`) is the only thing that touches
the database; the pure functions are the authoritative computation
and the test surface.

Why trailing average: a single-block emission snapshot is noisy —
subnets rotate, validators miss, registration windows spike.
Trailing N-block average smooths that variance. The window size is
a parameter; the service layer chooses it (default = a full day of
blocks, ~7200).
"""
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


# Default model version. Bump on any change to the revenue / ROI math.
SERVICE_MODEL_VERSION = "v1.0"

# How many blocks we treat as "full confidence" for the trailing average.
# ~7200 blocks ≈ 24h on a 12-second block time. Anything below this
# fraction scales confidence linearly toward 0.
DEFAULT_FULL_CONFIDENCE_BLOCKS = 7200

# Bittensor block time is ~12s; one month ≈ 30 * 24 * 60 * 60 / 12 ≈ 216_000.
# We use 30_000 as a conservative round number — emissions per block are
# already denominated in TAO, so blocks/month * (TAO/block) * (USD/TAO) = USD/month.
DEFAULT_BLOCKS_PER_MONTH = 30_000


@dataclass(frozen=True)
class RevenueProjection:
    """Revenue half of the projection. No cost / ROI here."""
    monthly_revenue_usd: float
    confidence: float
    sample_size: int
    model_version: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "monthly_revenue_usd": self.monthly_revenue_usd,
            "confidence": self.confidence,
            "sample_size": self.sample_size,
            "model_version": self.model_version,
        }


@dataclass(frozen=True)
class ProfitabilityProjection:
    """Full projection: revenue + cost + ROI + confidence."""
    monthly_revenue_usd: float
    monthly_cost_usd: float
    monthly_profit_usd: Optional[float]
    roi: Optional[float]   # profit / cost
    confidence: float
    currency: str
    sample_size: int
    model_version: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "monthly_revenue_usd": self.monthly_revenue_usd,
            "monthly_cost_usd": self.monthly_cost_usd,
            "monthly_profit_usd": self.monthly_profit_usd,
            "roi": self.roi,
            "confidence": self.confidence,
            "currency": self.currency,
            "sample_size": self.sample_size,
            "model_version": self.model_version,
        }


def _avg(values: List[float]) -> float:
    """Plain arithmetic mean. Empty list -> 0.0."""
    if not values:
        return 0.0
    return sum(values) / len(values)


def _confidence(sample_size: int, target: int) -> float:
    """Linear in [0, 1] up to `target`; clamped."""
    if target <= 0:
        return 1.0
    return max(0.0, min(1.0, sample_size / target))


def project_revenue(
    emission_history: List[float],
    tao_price_usd: float,
    *,
    blocks_per_month: int = DEFAULT_BLOCKS_PER_MONTH,
    target_sample_blocks: int = DEFAULT_FULL_CONFIDENCE_BLOCKS,
) -> RevenueProjection:
    """Compute projected monthly revenue from trailing emission history.

    Args:
        emission_history: list of TAO emissions per block, oldest -> newest.
            Empty list is valid (yields 0 revenue, 0 confidence).
        tao_price_usd: USD per TAO at projection time. Caller-supplied —
            no live fetch in the pure layer.
        blocks_per_month: conversion factor (default 30_000).
        target_sample_blocks: full-confidence sample size (default 7200).

    Returns:
        RevenueProjection with monthly_revenue_usd, confidence, sample_size.
    """
    avg_per_block = _avg(emission_history)
    monthly_tau = avg_per_block * blocks_per_month
    monthly_usd = monthly_tau * tao_price_usd
    return RevenueProjection(
        monthly_revenue_usd=round(monthly_usd, 2),
        confidence=_confidence(len(emission_history), target_sample_blocks),
        sample_size=len(emission_history),
        model_version=SERVICE_MODEL_VERSION,
    )


def project_profitability(
    emission_history: List[float],
    monthly_cost_usd: float,
    currency: str,
    tao_price_usd: float,
    *,
    blocks_per_month: int = DEFAULT_BLOCKS_PER_MONTH,
    target_sample_blocks: int = DEFAULT_FULL_CONFIDENCE_BLOCKS,
) -> ProfitabilityProjection:
    """Compute full profitability projection: revenue + cost + ROI.

    Args:
        emission_history: trailing per-block emissions in TAO.
        monthly_cost_usd: from `Deployment.estimated_monthly_cost`.
        currency: passthrough (USD in practice; the cost was projected
            in the offer's currency, but Phase 8 assumes single-currency
            for simplicity — see deferred work).
        tao_price_usd: USD per TAO at projection time.

    Returns:
        ProfitabilityProjection. `monthly_profit_usd` and `roi` are
        `None` when cost is 0 (cannot divide).
    """
    rev = project_revenue(
        emission_history,
        tao_price_usd,
        blocks_per_month=blocks_per_month,
        target_sample_blocks=target_sample_blocks,
    )

    cost = float(monthly_cost_usd or 0.0)
    if cost > 0:
        profit = rev.monthly_revenue_usd - cost
        roi = profit / cost
    else:
        profit = None
        roi = None

    return ProfitabilityProjection(
        monthly_revenue_usd=rev.monthly_revenue_usd,
        monthly_cost_usd=round(cost, 2),
        monthly_profit_usd=round(profit, 2) if profit is not None else None,
        roi=round(roi, 4) if roi is not None else None,
        confidence=rev.confidence,
        currency=currency,
        sample_size=rev.sample_size,
        model_version=SERVICE_MODEL_VERSION,
    )
