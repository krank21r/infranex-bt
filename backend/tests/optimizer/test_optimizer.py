"""
Tests for the Optimizer module.

Pins the contract:
  - find_cost_savings returns the cheapest eligible offer.
  - evaluate_subnet_alternatives returns scored alternatives sorted by delta.
  - suggest_config_tweaks surfaces spot, VRAM, ports, and docker issues.
  - Pure helpers are deterministic and side-effect-free.
"""
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.optimizer.optimizer import (
    OPTIMIZER_MODEL_VERSION,
    Optimizer,
    _evaluate_subnet_alternative_pure,
    _score_cost_savings_pure,
    _suggest_config_tweaks_pure,
)

# ---------- pure helper tests ----------


class TestScoreCostSavingsPure:
    def test_returns_none_when_candidate_not_cheaper(self):
        result = _score_cost_savings_pure(2.0, 2.0, {}, {})
        assert result is None

    def test_returns_cheaper_offer_with_calculated_savings(self):
        offer = {"id": "of-1", "gpu_model_name": "A100", "region": "US"}
        result = _score_cost_savings_pure(3.0, 1.5, offer, {})
        assert result is not None
        assert result.savings_per_hour == 1.5
        assert result.savings_per_month == 1.5 * 730
        assert result.new_hourly_price == 1.5

    def test_confidence_is_one(self):
        result = _score_cost_savings_pure(2.0, 1.0, {}, {})
        assert result is not None
        assert result.confidence == 1.0


class TestEvaluateSubnetAlternativePure:
    def test_better_subnet_returns_recommendation_better(self):
        utility_data = {
            "subnet": {"name": "Subnet B", "description": "", "subnet_type": "", "metadata": {}},
            "readme_analysis": "",
            "metadata": {},
        }
        technical_data = {"requirements": {}, "gpus": [], "extraction_confidence": 0.0}
        economics_data = {
            "metrics": {
                "netuid": 2,
                "emission": 0.5,
                "average_incentive": 0.8,
                "total_stake": 10000,
                "top_5_concentration": 0.1,
                "top_10_concentration": 0.2,
                "miner_turnover": 0.05,
                "neuron_utilization": 0.6,
                "top_incentive": 0.9,
                "median_incentive": 0.7,
                "trust": 0.9,
                "consensus": 0.85,
                "validator_count": 64,
                "registration_cost": 0,
                "miner_count": 50,
                "registration_open": True,
            },
            "market": {},
            "gpu_cost_hourly": 0.0,
        }
        result = _evaluate_subnet_alternative_pure(
            current_score=30.0,
            utility_data=utility_data,
            technical_data=technical_data,
            economics_data=economics_data,
        )
        assert result.recommendation == "better"
        assert result.netuid == 2

    def test_worse_subnet_returns_recommendation_worse(self):
        utility_data = {
            "subnet": {"name": "Subnet C", "description": "", "subnet_type": "", "metadata": {}},
            "readme_analysis": "",
            "metadata": {},
        }
        technical_data = {"requirements": {}, "gpus": [], "extraction_confidence": 0.0}
        economics_data = {
            "metrics": {
                "netuid": 3,
                "emission": 0.01,
                "average_incentive": 0.01,
                "total_stake": 1000000,
                "top_5_concentration": 0.9,
                "top_10_concentration": 0.95,
                "miner_turnover": 0.01,
                "neuron_utilization": 0.1,
                "top_incentive": 0.02,
                "median_incentive": 0.005,
                "trust": 0.1,
                "consensus": 0.2,
                "validator_count": 5,
                "registration_cost": 0,
                "miner_count": 5,
                "registration_open": False,
            },
            "market": {},
            "gpu_cost_hourly": 0.0,
        }
        result = _evaluate_subnet_alternative_pure(
            current_score=80.0,
            utility_data=utility_data,
            technical_data=technical_data,
            economics_data=economics_data,
        )
        assert result.recommendation == "worse"


class TestSuggestConfigTweaksPure:
    def test_spot_instance_warning(self):
        config = {
            "offer": {"is_spot": True, "vram_gb": 80},
            "requirements": {},
        }
        suggestions = _suggest_config_tweaks_pure(config, {})
        assert any(s.key == "is_spot" for s in suggestions)

    def test_low_vram_warning(self):
        config = {
            "offer": {"is_spot": False, "vram_gb": 24},
            "requirements": {},
        }
        suggestions = _suggest_config_tweaks_pure(config, {})
        assert any(s.key == "vram_gb" for s in suggestions)

    def test_missing_startup_command(self):
        config = {
            "offer": {"is_spot": False, "vram_gb": 80},
            "requirements": {"startup_command": None},
        }
        suggestions = _suggest_config_tweaks_pure(config, {})
        assert any(s.key == "startup_command" for s in suggestions)

    def test_missing_ports(self):
        config = {
            "offer": {"is_spot": False, "vram_gb": 80},
            "requirements": {"ports": []},
        }
        suggestions = _suggest_config_tweaks_pure(config, {})
        assert any(s.key == "ports" for s in suggestions)

    def test_no_suggestions_when_config_is_complete(self):
        config = {
            "offer": {"is_spot": False, "vram_gb": 80},
            "requirements": {
                "startup_command": "python miner.py",
                "ports": [9944],
                "docker_required": True,
            },
        }
        suggestions = _suggest_config_tweaks_pure(config, {})
        assert suggestions == []


# ---------- model version pin ----------


def test_optimizer_model_version_is_v1():
    assert OPTIMIZER_MODEL_VERSION == "v1.0"


# ---------- service-level tests ----------


@pytest.mark.asyncio
async def test_find_cost_savings_returns_cheapest_eligible_offer():
    deployment_id = "dep-1"
    deployment = MagicMock()
    deployment.id = deployment_id
    deployment.deployment_config = {
        "offer": {"hourly_price": 5.0},
        "requirements": {"min_vram_gb": 40},
    }

    svc = Optimizer(db=AsyncMock())

    # Result queue: first call returns deployment, second returns offers
    results = [
        MagicMock(scalar_one_or_none=MagicMock(return_value=deployment)),
        MagicMock(all=MagicMock(return_value=[
            (
                MagicMock(
                    id="of-2",
                    hourly_price=3.0,
                    monthly_price=3.0 * 730,
                    vram_gb=80,
                    ram_gb=256,
                    storage_gb=1000,
                    is_spot=False,
                    instance_type="A100",
                    region="US",
                    provider_id="p1",
                    gpu_model_id="g1",
                    availability="available",
                ),
                "A100",
            ),
            (
                MagicMock(
                    id="of-3",
                    hourly_price=2.0,
                    monthly_price=2.0 * 730,
                    vram_gb=80,
                    ram_gb=256,
                    storage_gb=1000,
                    is_spot=False,
                    instance_type="A100",
                    region="EU",
                    provider_id="p2",
                    gpu_model_id="g1",
                    availability="available",
                ),
                "A100",
            ),
        ])),
    ]
    idx = {"n": 0}

    async def fake_execute(stmt):
        r = results[idx["n"]]
        idx["n"] += 1
        return r

    svc.db.execute = AsyncMock(side_effect=fake_execute)

    result = await svc.find_cost_savings(deployment_id)
    assert result is not None
    assert result.new_hourly_price == 2.0
    assert result.savings_per_month == (5.0 - 2.0) * 730


@pytest.mark.asyncio
async def test_find_cost_savings_returns_none_when_no_cheaper_offer():
    deployment_id = "dep-2"
    deployment = MagicMock()
    deployment.id = deployment_id
    deployment.deployment_config = {
        "offer": {"hourly_price": 1.0},
        "requirements": {"min_vram_gb": 24},
    }

    svc = Optimizer(db=AsyncMock())

    # Result queue: first call returns deployment, second returns empty offers
    results = [
        MagicMock(scalar_one_or_none=MagicMock(return_value=deployment)),
        MagicMock(all=MagicMock(return_value=[])),
    ]
    idx = {"n": 0}

    async def fake_execute(stmt):
        r = results[idx["n"]]
        idx["n"] += 1
        return r

    svc.db.execute = AsyncMock(side_effect=fake_execute)

    result = await svc.find_cost_savings(deployment_id)
    assert result is None
