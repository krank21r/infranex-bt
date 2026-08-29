"""
Tests for OpportunityService (Phase 5 wiring).

Pins the contract that score_subnet now consumes real Phase 4
SubnetRequirement rows (not an empty dict), specifically the
_requirements_to_dict mapping:

- None row -> {} (legacy short-circuit).
- Full row -> 16 mapped fields + extraction_confidence.
- VRAM coercion: None -> 0.0 (score path must never see None float).
- score_subnet threads a populated requirements dict into the score engine.
- score_subnet returns None when the subnet is missing (orchestration guard).

Pure-Python. No DB, no network. AsyncSession is mocked.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.services.opportunity_service import (
    OpportunityService,
    _requirements_to_dict,
    _metrics_to_dict,
    _market_to_dict,
    _subnet_metadata_to_dict,
)
from app.intelligence import SCORE_MODEL_VERSION
from app.models import SubnetRequirement, Subnet, SubnetMetrics, MarketData, GPUModel, Repository


# ---------- helpers ----------


def _make_service() -> OpportunityService:
    return OpportunityService(db=AsyncMock())


def _make_requirement(**overrides) -> MagicMock:
    """Build a MagicMock standing in for a SubnetRequirement row."""
    defaults = {
        "python_version": "3.10",
        "cuda_version": "12.1",
        "pytorch_version": "2.1.0",
        "min_vram_gb": 24.0,
        "recommended_gpu": "A100",
        "ram_gb": 64.0,
        "cpu_cores": 16,
        "storage_gb": 200.0,
        "docker_required": True,
        "nvidia_runtime_required": True,
        "ports": [8091, 8092],
        "env_variables": {"WALLET": "default"},
        "startup_command": "python -m miner.start",
        "miner_command": "python -m miner.run",
        "dependencies": {"bt_version": "6.9.0"},
        "raw_requirements": {"source": "README.md"},
        "extraction_confidence": 0.92,
    }
    defaults.update(overrides)
    return MagicMock(spec=SubnetRequirement, **defaults)


# ---------- _requirements_to_dict ----------


def test_requirements_to_dict_none_returns_empty_dict():
    assert _requirements_to_dict(None) == {}


def test_requirements_to_dict_maps_all_sixteen_fields_plus_confidence():
    r = _make_requirement()
    out = _requirements_to_dict(r)
    assert len(out) == 17
    assert out["python_version"] == "3.10"
    assert out["cuda_version"] == "12.1"
    assert out["pytorch_version"] == "2.1.0"
    assert out["min_vram_gb"] == 24.0
    assert out["recommended_gpu"] == "A100"
    assert out["ram_gb"] == 64.0
    assert out["cpu_cores"] == 16
    assert out["storage_gb"] == 200.0
    assert out["docker_required"] is True
    assert out["nvidia_runtime_required"] is True
    assert out["ports"] == [8091, 8092]
    assert out["env_variables"] == {"WALLET": "default"}
    assert out["startup_command"] == "python -m miner.start"
    assert out["miner_command"] == "python -m miner.run"
    assert out["dependencies"] == {"bt_version": "6.9.0"}
    assert out["raw_requirements"] == {"source": "README.md"}
    assert out["extraction_confidence"] == 0.92


def test_requirements_to_dict_coerces_none_vram_to_zero():
    r = _make_requirement(
        min_vram_gb=None,
        ram_gb=None,
        storage_gb=None,
        cpu_cores=None,
        extraction_confidence=None,
        ports=None,
        env_variables=None,
        dependencies=None,
        raw_requirements=None,
    )
    out = _requirements_to_dict(r)
    assert out["min_vram_gb"] == 0.0
    assert out["ram_gb"] == 0.0
    assert out["storage_gb"] == 0.0
    assert out["extraction_confidence"] == 0.0
    assert out["cpu_cores"] is None
    assert out["ports"] == []
    assert out["env_variables"] == {}
    assert out["dependencies"] == {}
    assert out["raw_requirements"] == {}


# ---------- score_subnet orchestration ----------


def test_score_subnet_threads_requirements_into_score_engine(monkeypatch):
    """score_subnet passes the populated requirements dict (not {}) to the score engine."""
    captured = {}

    def fake_score(utility_data, technical_data, economics_data):
        captured["utility_data"] = utility_data
        captured["technical_data"] = technical_data
        captured["economics_data"] = economics_data
        return {
            "netuid": 1,
            "total_score": 75.0,
            "model_version": SCORE_MODEL_VERSION,
            "pillar_scores": {"utility": 60.0, "technical": 80.0, "economics": 70.0},
            "decision": "RUN",
            "components": [],
            "summary": "test summary",
        }

    import asyncio

    async def _fake_gpu_cost(db):
        return 0.0

    monkeypatch.setattr(
        "app.services.opportunity_service.compute_opportunity_score",
        fake_score,
    )
    monkeypatch.setattr(
        "app.services.opportunity_service._get_gpu_cost_hourly",
        _fake_gpu_cost,
    )

    svc = _make_service()
    subnet = MagicMock(spec=Subnet, netuid=1, name="testnet", description="desc", subnet_type="ai", extra_metadata={})
    metrics = MagicMock(spec=SubnetMetrics, netuid=1)
    market = MagicMock(spec=MarketData)
    req = _make_requirement()
    gpu = MagicMock(vram_gb=80.0)
    repo = MagicMock(spec=Repository, readme_content="# README")

    call_count = {"n": 0}

    async def cycling_execute(stmt):
        call_count["n"] += 1
        result = MagicMock()
        if call_count["n"] == 1:
            result.scalar_one_or_none.return_value = subnet
        elif call_count["n"] == 2:
            result.scalar_one_or_none.return_value = metrics
        elif call_count["n"] == 3:
            result.scalar_one_or_none.return_value = req
        elif call_count["n"] == 4:
            result.scalar_one_or_none.return_value = market
        elif call_count["n"] == 5:
            result.scalars.return_value.all.return_value = [req]
        elif call_count["n"] == 6:
            result.scalars.return_value.all.return_value = [gpu]
        elif call_count["n"] == 7:
            result.scalar_one_or_none.return_value = repo
        else:
            result.scalar_one_or_none.return_value = None
        result.scalars.return_value.all.return_value = []
        return result

    svc.db.execute = AsyncMock(side_effect=cycling_execute)
    svc.db.add = MagicMock()
    svc.db.flush = AsyncMock()

    import asyncio

    async def run():
        return await svc.score_subnet(1)

    out = asyncio.run(run())
    assert out is not None
    assert "technical_data" in captured
    assert "requirements" in captured["technical_data"]
    assert captured["technical_data"]["requirements"]["min_vram_gb"] == 24.0
    assert captured["technical_data"]["extraction_confidence"] == 0.92


def test_score_subnet_returns_none_when_subnet_missing():
    import asyncio

    async def run():
        svc = _make_service()

        async def empty_execute(stmt):
            result = MagicMock()
            result.scalar_one_or_none.return_value = None
            result.scalars.return_value.all.return_value = []
            return result

        svc.db.execute = AsyncMock(side_effect=empty_execute)
        return await svc.score_subnet(999)

    result = asyncio.run(run())
    assert result is None


def test_score_subnet_returns_none_when_metrics_missing():
    import asyncio

    async def run():
        svc = _make_service()
        subnet = MagicMock(spec=Subnet, netuid=1)

        async def empty_after_subnet(stmt):
            result = MagicMock()
            if "subnets" in str(stmt):
                result.scalar_one_or_none.return_value = subnet
            else:
                result.scalar_one_or_none.return_value = None
            result.scalars.return_value.all.return_value = []
            return result

        svc.db.execute = AsyncMock(side_effect=empty_after_subnet)
        return await svc.score_subnet(1)

    result = asyncio.run(run())
    assert result is None
