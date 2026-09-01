"""
Tests for OpportunityService v2.0 (3-pillar scoring).

Pins the contract that the service now:
- calls compute_opportunity_score with the 3-dict v2.0 signature
- returns pillar_scores in score_subnet
- persists utility/technical/economics pillar columns
- exposes get_pillar_breakdown
- supports decision filtering in list_current_opportunities / top_n
- exposes get_watchlist for WATCH-band subnets

Pure-Python. AsyncSession is mocked.
"""
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.intelligence import SCORE_MODEL_VERSION
from app.services.opportunity_service import (
    OpportunityService,
    _requirements_to_dict,
)

# ---------- helpers ----------


def _make_service() -> OpportunityService:
    return OpportunityService(db=AsyncMock())


def _make_requirement(**overrides) -> MagicMock:
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
    return MagicMock(**defaults)


def _make_subnet(**overrides) -> MagicMock:
    defaults = {
        "netuid": 1,
        "name": "Test Subnet",
        "description": "A test subnet",
        "subnet_type": "text",
        "owner_hotkey": "5xxx",
        "max_neurons": 1024,
        "max_allowed_validators": 128,
        "immunity_period": 7200,
        "tempo": 360,
        "is_active": True,
        "registration_open": True,
        "extra_metadata": {},
    }
    defaults.update(overrides)
    return MagicMock(**defaults)


def _make_metrics(**overrides) -> MagicMock:
    defaults = {
        "netuid": 1,
        "emission": 0.5,
        "average_incentive": 0.3,
        "total_stake": 1_000_000,
        "top_5_concentration": 0.3,
        "top_10_concentration": 0.5,
        "miner_turnover": 0.1,
        "neuron_utilization": 0.6,
        "top_incentive": 0.8,
        "median_incentive": 0.2,
        "registration_cost": 100.0,
        "miner_count": 50,
        "trust": 0.8,
        "consensus": 0.7,
        "validator_count": 64,
    }
    defaults.update(overrides)
    return MagicMock(**defaults)


def _make_market(**overrides) -> MagicMock:
    defaults = {
        "alpha_price_1d_change": 0.02,
        "liquidity": 500_000.0,
        "volume_market_cap_ratio": 0.1,
        "tao_price_usd": 200.0,
    }
    defaults.update(overrides)
    return MagicMock(**defaults)


# ---------- _requirements_to_dict ----------


def test_requirements_to_dict_none_returns_empty_dict():
    assert _requirements_to_dict(None) == {}


# ---------- score_subnet ----------


@pytest.mark.asyncio
async def test_score_subnet_returns_pillar_scores(monkeypatch):
    captured = {}

    def fake_score(utility_data, technical_data, economics_data):
        captured["utility_data"] = utility_data
        captured["technical_data"] = technical_data
        captured["economics_data"] = economics_data
        return {
            "total_score": 78.5,
            "model_version": SCORE_MODEL_VERSION,
            "pillar_scores": {
                "utility": 70.0,
                "technical": 80.0,
                "economics": 82.0,
            },
            "weights": {"utility": 0.30, "technical": 0.35, "economics": 0.35},
            "components": [
                {"pillar": "utility", "name": "problem_clarity", "score": 70.0, "weight": 0.30, "explanation": "ok"},
            ],
            "summary": "v2.0 summary",
            "decision": "WATCH",
        }

    monkeypatch.setattr(
        "app.services.opportunity_service.compute_opportunity_score",
        fake_score,
    )

    svc = _make_service()
    subnet = _make_subnet()
    metrics = _make_metrics()
    req = _make_requirement()
    market = _make_market()
    gpu = MagicMock(vram_gb=24.0)
    repo = MagicMock(readme_content="# Clear README")

    # Result queue for the 7 DB calls made by score_subnet:
    # 1. subnet, 2. metrics, 3. requirements, 4. market (latest_market),
    # 5. gpus (list_gpus), 6. repo, 7. gpu_cost_hourly (_get_gpu_cost_hourly)
    results = [
        MagicMock(scalar_one_or_none=MagicMock(return_value=subnet)),      # subnet
        MagicMock(scalar_one_or_none=MagicMock(return_value=metrics)),     # metrics
        MagicMock(scalar_one_or_none=MagicMock(return_value=req)),         # requirements
        MagicMock(scalar_one_or_none=MagicMock(return_value=market)),      # market
        MagicMock(scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[gpu])))),  # gpus
        MagicMock(scalar_one_or_none=MagicMock(return_value=repo)),        # repo
        MagicMock(scalar_one_or_none=MagicMock(return_value=MagicMock(hourly_price=2.5))),  # gpu_cost_hourly
    ]
    idx = {"n": 0}

    async def cycling_execute(stmt):
        r = results[idx["n"]] if idx["n"] < len(results) else MagicMock(scalar_one_or_none=MagicMock(return_value=None))
        idx["n"] += 1
        return r

    svc.db.execute = AsyncMock(side_effect=cycling_execute)

    result = await svc.score_subnet(1)
    assert result is not None
    assert result["pillar_scores"] == {
        "utility": 70.0,
        "technical": 80.0,
        "economics": 82.0,
    }
    assert result["model_version"] == SCORE_MODEL_VERSION
    assert "utility_data" in captured


@pytest.mark.asyncio
async def test_score_subnet_returns_none_when_subnet_missing():
    svc = _make_service()

    async def empty_execute(stmt):
        result = MagicMock()
        result.scalar_one_or_none.return_value = None
        result.scalars.return_value.all.return_value = []
        return result

    svc.db.execute = AsyncMock(side_effect=empty_execute)
    result = await svc.score_subnet(999)
    assert result is None


# ---------- persist_score ----------


@pytest.mark.asyncio
async def test_persist_score_saves_pillar_columns(monkeypatch):
    svc = _make_service()
    score = {
        "total_score": 78.5,
        "model_version": SCORE_MODEL_VERSION,
        "pillar_scores": {
            "utility": 70.0,
            "technical": 80.0,
            "economics": 82.0,
        },
        "components": [
            {"name": "problem_clarity", "score": 70.0, "weight": 0.30, "explanation": "ok"},
        ],
        "summary": "v2.0 summary",
        "weights": {"utility": 0.30, "technical": 0.35, "economics": 0.35},
        "decision": "WATCH",
    }

    captured_row = {}

    async def fake_flush():
        pass

    async def fake_commit():
        pass

    async def fake_refresh(row):
        captured_row["id"] = row.id
        captured_row["utility_score"] = row.utility_score
        captured_row["technical_score"] = row.technical_score
        captured_row["economics_score"] = row.economics_score
        captured_row["decision"] = row.decision
        captured_row["pillar_version"] = row.pillar_version
        captured_row["extra_metadata"] = row.extra_metadata

    svc.db.add = MagicMock()
    svc.db.flush = AsyncMock(side_effect=fake_flush)
    svc.db.commit = AsyncMock(side_effect=fake_commit)
    svc.db.refresh = AsyncMock(side_effect=fake_refresh)

    row = await svc.persist_score(1, score)
    assert row is not None
    assert captured_row["utility_score"] == 70.0
    assert captured_row["technical_score"] == 80.0
    assert captured_row["economics_score"] == 82.0
    assert captured_row["pillar_version"] == SCORE_MODEL_VERSION
    assert captured_row["decision"] == "WATCH"
    assert captured_row["extra_metadata"]["pillar_breakdown"] == {
        "utility": 70.0,
        "technical": 80.0,
        "economics": 82.0,
    }


# ---------- get_pillar_breakdown ----------


@pytest.mark.asyncio
async def test_get_pillar_breakdown():
    svc = _make_service()
    mock_row = MagicMock()
    mock_row.id = "score-1"
    mock_row.netuid = 1
    mock_row.score = 78.5
    mock_row.pillar_version = SCORE_MODEL_VERSION
    mock_row.decision = "WATCH"
    mock_row.utility_score = None
    mock_row.technical_score = None
    mock_row.economics_score = None
    mock_row.created_at.isoformat.return_value = "2024-01-01T00:00:00+00:00"

    mock_comp = MagicMock()
    mock_comp.component_name = "problem_clarity"
    mock_comp.score = 70.0
    mock_comp.weight = 0.30
    mock_comp.explanation = "ok"
    mock_comp.raw_values = {"name": "problem_clarity"}

    mock_row.score_components = [mock_comp]

    async def fake_execute(stmt):
        result = MagicMock()
        result.scalar_one_or_none.return_value = mock_row
        return result

    svc.db.execute = AsyncMock(side_effect=fake_execute)

    result = await svc.get_pillar_breakdown("score-1")
    assert result is not None
    assert result["total_score"] == 78.5
    assert result["decision"] == "WATCH"
    assert result["pillar_scores"]["utility"] is None
    assert result["pillar_scores"]["technical"] is None
    assert result["pillar_scores"]["economics"] is None
    assert len(result["components"]) == 1
    assert result["components"][0]["name"] == "problem_clarity"


# ---------- list_current_opportunities with decision filter ----------


@pytest.mark.asyncio
async def test_list_by_decision_filter():
    svc = _make_service()
    mock_rows = [MagicMock(), MagicMock()]

    async def fake_execute(stmt):
        result = MagicMock()
        result.scalar.return_value = 2
        result.scalars.return_value.all.return_value = mock_rows
        return result

    svc.db.execute = AsyncMock(side_effect=fake_execute)
    svc.db.scalar = AsyncMock(return_value=2)

    rows, total = await svc.list_current_opportunities(
        page=1,
        page_size=20,
        decision="RUN",
    )
    assert rows == mock_rows
    assert total == 2


# ---------- get_watchlist ----------


@pytest.mark.asyncio
async def test_get_watchlist():
    svc = _make_service()
    mock_rows = [MagicMock(), MagicMock(), MagicMock()]

    async def fake_execute(stmt):
        result = MagicMock()
        result.scalars.return_value.all.return_value = mock_rows
        return result

    svc.db.execute = AsyncMock(side_effect=fake_execute)

    rows = await svc.get_watchlist()
    assert rows == mock_rows
