"""
Tests for change detection — pure logic and service layer.

Pins the contract:
  - detect_subnet_changes returns structured diffs
  - Shift ratios are computed correctly
  - Impact levels are assigned correctly
  - Thresholds control sensitivity
  - should_trigger_rescore / should_raise_approval work correctly
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.intelligence.change_detection import (
    ChangeDetectionResult,
    SubnetStateDiff,
    MODEL_VERSION,
    DEFAULT_THRESHOLDS,
    detect_subnet_changes,
    should_trigger_rescore,
    should_raise_approval,
    _impact_from_ratio,
    _ratio,
)
from app.services.change_detection_service import ChangeDetectionService


# ---------- pure logic tests ----------


class TestRatio:
    def test_same_values_returns_zero(self):
        assert _ratio(5.0, 5.0) == 0.0

    def test_both_none_returns_zero(self):
        assert _ratio(None, None) == 0.0

    def test_one_none_returns_one(self):
        assert _ratio(None, 5.0) == 1.0
        assert _ratio(5.0, None) == 1.0

    def test_old_zero_new_nonzero_returns_one(self):
        assert _ratio(0.0, 5.0) == 1.0

    def test_old_zero_new_zero_returns_zero(self):
        assert _ratio(0.0, 0.0) == 0.0

    def test_percentage_change(self):
        assert _ratio(10.0, 12.0) == 0.2
        assert _ratio(10.0, 8.0) == 0.2


class TestImpactFromRatio:
    def test_none_below_005(self):
        assert _impact_from_ratio(0.04) == "none"

    def test_low_below_015(self):
        assert _impact_from_ratio(0.10) == "low"

    def test_medium_below_030(self):
        assert _impact_from_ratio(0.20) == "medium"

    def test_high_below_050(self):
        assert _impact_from_ratio(0.40) == "high"

    def test_critical_above_050(self):
        assert _impact_from_ratio(0.60) == "critical"


class TestDetectSubnetChanges:
    def test_no_changes_when_identical(self):
        state = {
            "metrics": {"emission": 0.5, "average_incentive": 0.3},
            "market": {"tao_price_usd": 200.0},
            "requirements": {"min_vram_gb": 24.0},
        }
        result = detect_subnet_changes(1, state, state)
        assert result.changes == []
        assert result.has_significant_change is False
        assert result.highest_impact == "none"

    def test_emission_shift_detected(self):
        old = {
            "metrics": {"emission": 0.5},
            "market": {},
            "requirements": {},
        }
        new = {
            "metrics": {"emission": 0.7},
            "market": {},
            "requirements": {},
        }
        result = detect_subnet_changes(1, old, new)
        assert len(result.changes) == 1
        assert result.changes[0].change_type == "emission_shift"
        assert result.changes[0].field == "emission"
        assert result.changes[0].old_value == 0.5
        assert result.changes[0].new_value == 0.7

    def test_emission_shift_below_threshold_ignored(self):
        old = {
            "metrics": {"emission": 0.5},
            "market": {},
            "requirements": {},
        }
        new = {
            "metrics": {"emission": 0.52},
            "market": {},
            "requirements": {},
        }
        result = detect_subnet_changes(1, old, new)
        assert result.changes == []

    def test_requirement_change_detected(self):
        old = {
            "metrics": {},
            "market": {},
            "requirements": {"min_vram_gb": 24.0, "cuda_version": "12.1"},
        }
        new = {
            "metrics": {},
            "market": {},
            "requirements": {"min_vram_gb": 48.0, "cuda_version": "12.1"},
        }
        result = detect_subnet_changes(1, old, new)
        req_changes = [c for c in result.changes if c.change_type == "requirement_change"]
        assert len(req_changes) == 1
        assert req_changes[0].field == "min_vram_gb"

    def test_market_shift_detected(self):
        old = {
            "metrics": {},
            "market": {"tao_price_usd": 200.0},
            "requirements": {},
        }
        new = {
            "metrics": {},
            "market": {"tao_price_usd": 300.0},
            "requirements": {},
        }
        result = detect_subnet_changes(1, old, new)
        market_changes = [c for c in result.changes if c.change_type == "market_shift"]
        assert len(market_changes) == 1
        assert market_changes[0].field == "tao_price_usd"

    def test_registration_change_detected(self):
        old = {
            "metrics": {"registration_cost": 100.0, "registration_open": True},
            "market": {},
            "requirements": {},
        }
        new = {
            "metrics": {"registration_cost": 100.0, "registration_open": False},
            "market": {},
            "requirements": {},
        }
        result = detect_subnet_changes(1, old, new)
        reg_changes = [c for c in result.changes if c.change_type == "registration_change"]
        assert len(reg_changes) == 1
        assert reg_changes[0].field == "registration_open"

    def test_multiple_changes(self):
        old = {
            "metrics": {"emission": 0.5, "total_stake": 1000000},
            "market": {"tao_price_usd": 200.0},
            "requirements": {"min_vram_gb": 24.0},
        }
        new = {
            "metrics": {"emission": 0.8, "total_stake": 1500000},
            "market": {"tao_price_usd": 350.0},
            "requirements": {"min_vram_gb": 48.0},
        }
        result = detect_subnet_changes(1, old, new)
        assert len(result.changes) >= 3
        assert result.has_significant_change is True

    def test_custom_thresholds(self):
        old = {
            "metrics": {"emission": 0.5},
            "market": {},
            "requirements": {},
        }
        new = {
            "metrics": {"emission": 0.55},
            "market": {},
            "requirements": {},
        }
        # Default threshold is 0.10, so 0.10 shift should be detected
        result = detect_subnet_changes(1, old, new)
        assert len(result.changes) == 1

        # With higher threshold, should not be detected
        result = detect_subnet_changes(
            1, old, new, thresholds={"emission_shift": 0.20},
        )
        assert len(result.changes) == 0

    def test_model_version(self):
        result = detect_subnet_changes(1, {}, {})
        assert result.model_version == MODEL_VERSION


class TestShouldTriggerRescore:
    def test_high_impact_triggers(self):
        result = ChangeDetectionResult(
            netuid=1, changes=[], has_significant_change=True,
            highest_impact="high", detected_at="2026-01-01T00:00:00Z",
        )
        assert should_trigger_rescore(result) is True

    def test_critical_impact_triggers(self):
        result = ChangeDetectionResult(
            netuid=1, changes=[], has_significant_change=True,
            highest_impact="critical", detected_at="2026-01-01T00:00:00Z",
        )
        assert should_trigger_rescore(result) is True

    def test_medium_impact_does_not_trigger(self):
        result = ChangeDetectionResult(
            netuid=1, changes=[], has_significant_change=True,
            highest_impact="medium", detected_at="2026-01-01T00:00:00Z",
        )
        assert should_trigger_rescore(result) is False


class TestShouldRaiseApproval:
    def test_critical_raises(self):
        result = ChangeDetectionResult(
            netuid=1, changes=[], has_significant_change=True,
            highest_impact="critical", detected_at="2026-01-01T00:00:00Z",
        )
        assert should_raise_approval(result) is True

    def test_high_does_not_raise(self):
        result = ChangeDetectionResult(
            netuid=1, changes=[], has_significant_change=True,
            highest_impact="high", detected_at="2026-01-01T00:00:00Z",
        )
        assert should_raise_approval(result) is False


# ---------- service layer tests ----------


class TestChangeDetectionService:
    @pytest.mark.asyncio
    async def test_detect_for_subnet_no_changes(self):
        db = AsyncMock()
        svc = ChangeDetectionService(db)

        # Mock empty baseline and current state
        db.execute = AsyncMock(return_value=MagicMock(
            scalar_one_or_none=MagicMock(return_value=None),
            scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[]))),
        ))

        result = await svc.detect_for_subnet(1)
        assert result.netuid == 1
        assert result.changes == []

    @pytest.mark.asyncio
    async def test_detect_for_subnet_with_changes(self):
        db = AsyncMock()
        svc = ChangeDetectionService(db)

        # Build mock subnet
        subnet = MagicMock()
        subnet.registration_open = True

        # Build mock metrics with emission shift
        new_metrics = MagicMock()
        new_metrics.emission = 0.8  # 60% shift - critical
        new_metrics.average_incentive = 0.3
        new_metrics.total_stake = 1000000
        new_metrics.top_5_concentration = 0.3
        new_metrics.top_10_concentration = 0.5
        new_metrics.miner_turnover = 0.1
        new_metrics.neuron_utilization = 0.6
        new_metrics.trust = 0.8
        new_metrics.consensus = 0.7
        new_metrics.registration_cost = 100.0
        new_metrics.registration_open = True
        new_metrics.miner_count = 50
        new_metrics.validator_count = 64

        # Build mock requirements (same values to avoid false positives)
        req = MagicMock()
        req.min_vram_gb = 24.0
        req.recommended_gpu = "A100"
        req.cuda_version = "12.1"
        req.pytorch_version = "2.1.0"
        req.ram_gb = 64.0
        req.cpu_cores = 16
        req.storage_gb = 200.0
        req.docker_required = True
        req.nvidia_runtime_required = True
        req.startup_command = "python -m miner.start"
        req.miner_command = "python -m miner.run"

        # Result queue: subnet, metrics, market, requirements
        results = [
            MagicMock(scalar_one_or_none=MagicMock(return_value=subnet)),  # subnet
            MagicMock(scalar_one_or_none=MagicMock(return_value=new_metrics)),  # metrics
            MagicMock(scalar_one_or_none=MagicMock(return_value=None)),  # market
            MagicMock(scalar_one_or_none=MagicMock(return_value=req)),  # requirements
        ]
        idx = {"n": 0}

        async def fake_execute(stmt):
            r = results[idx["n"]] if idx["n"] < len(results) else MagicMock(scalar_one_or_none=MagicMock(return_value=None))
            idx["n"] += 1
            return r

        db.execute = AsyncMock(side_effect=fake_execute)
        db.add = MagicMock()
        db.flush = AsyncMock()

        result = await svc.detect_for_subnet(1)
        assert result.netuid == 1
        assert len(result.changes) >= 1
        # Should detect emission shift (0.5 -> 0.8 is 60% change)
        emission_changes = [c for c in result.changes if c.change_type == "emission_shift"]
        assert len(emission_changes) == 1
        assert emission_changes[0].field == "emission"

    @pytest.mark.asyncio
    async def test_detect_for_all_handles_errors(self):
        db = AsyncMock()
        svc = ChangeDetectionService(db)

        # First call raises, rest return empty results
        call_count = {"n": 0}

        async def fake_execute(stmt):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise ConnectionError("DB connection lost")
            return MagicMock(
                scalar_one_or_none=MagicMock(return_value=None),
                scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[]))),
            )

        db.execute = AsyncMock(side_effect=fake_execute)
        db.add = MagicMock()
        db.flush = AsyncMock()

        results = await svc.detect_for_all([1, 2, 3])
        # All subnets should complete without raising
        # (errors are caught internally)
        assert isinstance(results, list)
