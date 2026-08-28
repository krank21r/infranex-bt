"""
Tests for the monitoring + rewards engine (Phase 9).

Pins the two load-bearing invariants of the migrator:

  1. Negative-ROI history -> should_migrate=True with a reason that
     mentions "rolling ROI negative".
  2. Sub-`min_observations` history -> should_migrate=False, even
     when the underlying ROI is negative. This is the
     "suppress startup noise" floor; if it ever regresses, every
     freshly-deployed miner will migrate on its first empty block.
"""
import pytest

from app.intelligence.monitoring import (
    should_migrate,
    compute_rolling_roi,
    record_emission,
    MONITOR_MODEL_VERSION,
    DEFAULT_MIN_OBSERVATIONS,
    BLOCKS_PER_MONTH,
)


# ---------- helpers ----------


def _stable_obs(per_block_tao: float, n: int, start_block: int = 1):
    """Build `n` (block, tao_per_block) observations, oldest -> newest."""
    return [(start_block + i, per_block_tao) for i in range(n)]


# ---------- record_emission (shape only) ----------


def test_record_emission_returns_canonical_shape():
    """Sanity: one observation round-trips into the canonical dict shape."""
    row = record_emission(block=12345, netuid=7, tao_per_block=0.01)
    assert row == {"block": 12345, "netuid": 7, "tao_per_block": 0.01}


# ---------- should_migrate: negative ROI over sufficient history ----------


def test_should_migrate_true_when_rolling_roi_negative_and_enough_data():
    """Stable-low emissions over 20 blocks at $100/TAO vs $5000 cost.

    Per-block revenue: 0.0001 * 30_000 * 100 = $300/month
    ROI: (300 - 5000) / 5000 = -0.94  -> clearly negative.
    Sample size 20 >= DEFAULT_MIN_OBSERVATIONS (10)  -> should_migrate=True.
    """
    # 0.0001 TAO/block at $100/TAO -> $300/month revenue. Cost is $5000.
    obs = _stable_obs(per_block_tao=0.0001, n=20)
    signal = should_migrate(
        observations=obs,
        monthly_cost_usd=5000.0,
        tao_price_usd=100.0,
    )
    assert signal.should_migrate is True
    assert signal.sample_size == 20
    assert signal.rolling_roi is not None
    assert signal.rolling_roi < 0
    assert "negative" in signal.reason.lower()
    assert signal.model_version == "v1.0"


# ---------- should_migrate: sub-min_observations floor ----------


def test_should_migrate_false_when_sample_below_min_observations_floor():
    """Even with negative ROI, 1 observation must not trigger a migrate.

    This is the load-bearing startup-noise guard. A freshly-deployed
    miner records its first block; if the per-block revenue is tiny
    vs the cost (which is the typical case for the first block),
    the ROI is hugely negative — and we'd migrate on it. The
    `min_observations` floor prevents that.
    """
    # Same deeply-negative ROI as the test above, but only 1 observation.
    obs = _stable_obs(per_block_tao=0.0001, n=1)
    signal = should_migrate(
        observations=obs,
        monthly_cost_usd=5000.0,
        tao_price_usd=100.0,
    )
    assert signal.should_migrate is False
    assert signal.sample_size == 1
    assert signal.sample_size < DEFAULT_MIN_OBSERVATIONS
    assert "insufficient data" in signal.reason.lower()
    # Rolling ROI is still computed; we just don't act on it.
    assert signal.rolling_roi is not None
    assert signal.rolling_roi < 0


# ---------- model version pin ----------


def test_monitor_model_version_is_v1():
    """Version pin — bump on any change to the migrate rule."""
    assert MONITOR_MODEL_VERSION == "v1.0"
    assert DEFAULT_MIN_OBSERVATIONS == 10
    assert BLOCKS_PER_MONTH == 30_000
