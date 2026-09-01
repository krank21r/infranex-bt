"""
Tests for the profitability engine (Phase 8).

Pins the happy-path contract for the pure projector:

  - project_revenue: trailing average × blocks/month × TAO price.
  - confidence scales with sample size (linear, clamped to [0, 1]).
  - project_profitability: revenue + cost + ROI when cost > 0.
  - model_version is pinned at "v1.0".

Service-layer mocking is intentionally out of scope for the 1-test
min-viable contract — the pure layer is the authoritative computation.
"""

from app.intelligence.profitability import (
    DEFAULT_BLOCKS_PER_MONTH,
    DEFAULT_FULL_CONFIDENCE_BLOCKS,
    SERVICE_MODEL_VERSION,
    project_profitability,
    project_revenue,
)

# ---------- helpers ----------


def _stable_history(per_block_tao: float = 0.01, n: int = 7200) -> list:
    """A flat emission history of `n` blocks each paying `per_block_tao`."""
    return [per_block_tao] * n


# ---------- project_revenue ----------


def test_project_revenue_trailing_average_times_tao_price():
    """avg_per_block * blocks_per_month * tao_price_usd, rounded to 2dp."""
    history = _stable_history(per_block_tao=0.01, n=7200)
    proj = project_revenue(history, tao_price_usd=100.0)
    # 0.01 TAO/block * 30_000 blocks/month * $100/TAO = $30_000
    assert proj.monthly_revenue_usd == 30_000.0
    assert proj.model_version == "v1.0"
    assert proj.sample_size == 7200
    # 7200 / 7200 = 1.0 confidence at the full sample size.
    assert proj.confidence == 1.0


# ---------- project_profitability ----------


def test_project_profitability_revenue_cost_roi_happy_path():
    """Revenue > cost -> positive profit, ROI > 0, version stamped."""
    history = _stable_history(per_block_tao=0.01, n=7200)  # $30k revenue
    monthly_cost = 5000.0  # well under revenue
    proj = project_profitability(
        emission_history=history,
        monthly_cost_usd=monthly_cost,
        currency="USD",
        tao_price_usd=100.0,
    )

    # Revenue: 0.01 * 30_000 * 100 = $30_000
    assert proj.monthly_revenue_usd == 30_000.0
    # Cost: passthrough, rounded
    assert proj.monthly_cost_usd == 5000.0
    # Profit: 30_000 - 5_000 = $25_000
    assert proj.monthly_profit_usd == 25_000.0
    # ROI: 25_000 / 5_000 = 5.0
    assert proj.roi == 5.0
    # Identity passthroughs
    assert proj.currency == "USD"
    assert proj.model_version == "v1.0"
    assert proj.sample_size == 7200
    assert proj.confidence == 1.0


# ---------- model version pin ----------


def test_model_version_is_v1():
    """Version pin — must be bumped on any formula change."""
    assert SERVICE_MODEL_VERSION == "v1.0"
    # Defaults exposed for service-layer to reference, not magic numbers.
    assert DEFAULT_BLOCKS_PER_MONTH == 30_000
    assert DEFAULT_FULL_CONFIDENCE_BLOCKS == 7200
