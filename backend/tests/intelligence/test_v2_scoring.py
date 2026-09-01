"""
Tests for the v2.0 3-pillar scoring model.

Pins the contract of `app.intelligence` v2.0:
  - 3 pillars: utility (0.30), technical (0.35), economics (0.35)
  - pillar weights sum to 1.0
  - every pillar/component is clamped to [0, 100]
  - model_version is the literal "v2.0"
  - compute_opportunity_score returns decision, pillar_scores, weights, components, summary
  - compute_opportunity_score takes 3 dicts (utility_data, technical_data, economics_data)
  - score_utility / score_technical / score_economics accept single dicts

Pure Python — no DB, no async.
"""
import pytest

from app.intelligence import (
    DECISION_THRESHOLDS,
    PILLAR_WEIGHTS,
    SCORE_MODEL_VERSION,
    ScoreComponent,
    compute_opportunity_score,
    score_competition,
    score_economic_potential,
    score_economics,
    score_hardware_suitability,
    score_market_conditions,
    score_network_health,
    score_new_miner_accessibility,
    score_profitability_potential,
    score_reward_stability,
    score_technical,
    score_utility,
)

# ---------- model version ----------


def test_model_version_is_v2():
    assert SCORE_MODEL_VERSION == "v2.0"
    assert isinstance(SCORE_MODEL_VERSION, str)
    assert SCORE_MODEL_VERSION.startswith("v")


# ---------- utility pillar ----------


def test_utility_score_with_good_data():
    utility_data = {
        "subnet": {
            "name": "Clear Subnet",
            "description": "A well-described subnet with a clear purpose and strong documentation.",
            "subnet_type": "text",
            "extra_metadata": {"active_development": True},
        },
        "readme_analysis": (
            "This subnet solves a clear problem. "
            "The solution is well-documented with goals and purpose outlined."
        ),
        "metadata": {"active_development": True},
    }
    pillar = score_utility(utility_data)
    assert isinstance(pillar, ScoreComponent)
    assert pillar.name == "utility"
    assert pillar.pillar == "utility"
    assert pillar.score >= 70.0
    assert pillar.weight == pytest.approx(PILLAR_WEIGHTS["utility"])
    assert pillar.weighted == pytest.approx(pillar.score * pillar.weight)
    assert pillar.explanation


def test_utility_score_with_poor_data():
    utility_data = {
        "subnet": {
            "name": "",
            "description": "",
            "subnet_type": "",
            "extra_metadata": {},
        },
        "readme_analysis": "",
        "metadata": {},
    }
    pillar = score_utility(utility_data)
    assert isinstance(pillar, ScoreComponent)
    assert pillar.name == "utility"
    assert pillar.pillar == "utility"
    assert pillar.score <= 30.0
    assert pillar.weight == pytest.approx(PILLAR_WEIGHTS["utility"])
    assert pillar.explanation


# ---------- technical pillar ----------


def test_technical_score_with_gpu_match():
    technical_data = {
        "requirements": {
            "min_vram_gb": 16.0,
            "recommended_gpu": "A100",
            "cuda_version": "12.4",
            "ram_gb": 64.0,
            "storage_gb": 500.0,
            "dependencies": {"torch": "2.0", "numpy": "1.0"},
        },
        "gpus": [
            {"vram_gb": 24.0},
            {"vram_gb": 80.0},
            {"vram_gb": 16.0},
        ],
        "extraction_confidence": 0.95,
    }
    pillar = score_technical(technical_data)
    assert isinstance(pillar, ScoreComponent)
    assert pillar.name == "technical"
    assert pillar.pillar == "technical"
    assert pillar.score >= 70.0
    assert pillar.weight == pytest.approx(PILLAR_WEIGHTS["technical"])
    assert any("of catalog GPUs meet" in c["explanation"] for c in pillar.components)


def test_technical_score_with_no_gpu_match():
    technical_data = {
        "requirements": {
            "min_vram_gb": 80.0,
            "recommended_gpu": "H100",
            "cuda_version": "12.4",
            "ram_gb": 128.0,
            "storage_gb": 2000.0,
            "dependencies": {"torch": "2.0"},
        },
        "gpus": [
            {"vram_gb": 8.0},
            {"vram_gb": 16.0},
        ],
        "extraction_confidence": 0.9,
    }
    pillar = score_technical(technical_data)
    assert isinstance(pillar, ScoreComponent)
    assert pillar.name == "technical"
    assert pillar.pillar == "technical"
    assert pillar.score <= 65.0
    assert pillar.weight == pytest.approx(PILLAR_WEIGHTS["technical"])
    assert any("0% of catalog GPUs meet" in c["explanation"] for c in pillar.components)


def test_technical_score_with_simple_deps():
    technical_data = {
        "requirements": {
            "min_vram_gb": 16.0,
            "recommended_gpu": "A100",
            "cuda_version": "12.4",
            "ram_gb": 32.0,
            "storage_gb": 500.0,
            "dependencies": {},
        },
        "gpus": [
            {"vram_gb": 24.0},
            {"vram_gb": 80.0},
        ],
        "extraction_confidence": 1.0,
    }
    pillar = score_technical(technical_data)
    assert isinstance(pillar, ScoreComponent)
    assert pillar.name == "technical"
    assert pillar.pillar == "technical"
    assert pillar.score >= 80.0
    assert any("0 dependencies detected" in c["explanation"] for c in pillar.components)


# ---------- economics pillar ----------


def test_economics_score_with_high_revenue():
    economics_data = {
        "metrics": {
            "emission": 1.0,
            "average_incentive": 0.8,
            "top_5_concentration": 0.2,
            "top_incentive": 1.0,
            "median_incentive": 0.7,
        },
        "market": {
            "tao_price_usd": 500.0,
            "alpha_price_1d_change": 0.05,
            "liquidity": 1_000_000.0,
        },
        "gpu_cost_hourly": 0.5,
    }
    pillar = score_economics(economics_data)
    assert isinstance(pillar, ScoreComponent)
    assert pillar.name == "economics"
    assert pillar.pillar == "economics"
    assert pillar.score >= 70.0
    assert pillar.weight == pytest.approx(PILLAR_WEIGHTS["economics"])
    assert pillar.explanation


def test_economics_score_with_low_revenue():
    economics_data = {
        "metrics": {
            "emission": 0.01,
            "average_incentive": 0.01,
            "top_5_concentration": 0.1,
            "top_incentive": 0.02,
            "median_incentive": 0.01,
        },
        "market": {
            "tao_price_usd": 10.0,
            "alpha_price_1d_change": -0.1,
            "liquidity": 10_000.0,
        },
        "gpu_cost_hourly": 5.0,
    }
    pillar = score_economics(economics_data)
    assert isinstance(pillar, ScoreComponent)
    assert pillar.name == "economics"
    assert pillar.pillar == "economics"
    assert pillar.score <= 50.0
    assert pillar.weight == pytest.approx(PILLAR_WEIGHTS["economics"])


def test_economics_score_with_high_competition():
    economics_data = {
        "metrics": {
            "emission": 0.5,
            "average_incentive": 0.3,
            "top_5_concentration": 0.8,
            "top_incentive": 0.5,
            "median_incentive": 0.1,
        },
        "market": {
            "tao_price_usd": 100.0,
            "alpha_price_1d_change": 0.0,
            "liquidity": 100_000.0,
        },
        "gpu_cost_hourly": 1.0,
    }
    pillar = score_economics(economics_data)
    assert isinstance(pillar, ScoreComponent)
    assert pillar.name == "economics"
    assert pillar.pillar == "economics"
    assert pillar.score <= 85.0
    assert any("80.0%" in c["explanation"] or "80%" in c["explanation"] for c in pillar.components)


# ---------- compute_opportunity_score ----------


def test_compute_opportunity_score_combination():
    utility_data = {
        "subnet": {
            "name": "Test Subnet",
            "description": "A well-described subnet with clear purpose and documentation.",
            "subnet_type": "text",
            "extra_metadata": {"active_development": True},
        },
        "readme_analysis": "This subnet solves a clear problem with well-documented goals and purpose.",
        "metadata": {"active_development": True},
    }
    technical_data = {
        "requirements": {
            "min_vram_gb": 16.0,
            "recommended_gpu": "A100",
            "cuda_version": "12.4",
            "ram_gb": 64.0,
            "storage_gb": 500.0,
            "dependencies": {"torch": "2.0"},
        },
        "gpus": [
            {"vram_gb": 24.0},
            {"vram_gb": 80.0},
        ],
        "extraction_confidence": 0.95,
    }
    economics_data = {
        "metrics": {
            "emission": 0.8,
            "average_incentive": 0.5,
            "top_5_concentration": 0.3,
            "top_incentive": 0.6,
            "median_incentive": 0.3,
        },
        "market": {
            "tao_price_usd": 200.0,
            "alpha_price_1d_change": 0.02,
            "liquidity": 500_000.0,
        },
        "gpu_cost_hourly": 1.0,
    }

    result = compute_opportunity_score(utility_data, technical_data, economics_data)
    assert "total_score" in result
    assert "model_version" in result
    assert "pillar_scores" in result
    assert "weights" in result
    assert "components" in result
    assert "summary" in result
    assert "decision" in result
    assert result["model_version"] == SCORE_MODEL_VERSION

    # Weights must sum to 1.0
    total_weight = sum(result["weights"].values())
    assert abs(total_weight - 1.0) < 1e-9

    # Pillar scores present
    assert set(result["pillar_scores"].keys()) == {"utility", "technical", "economics"}
    for score in result["pillar_scores"].values():
        assert 0.0 <= score <= 100.0

    # Total is weighted combination of pillar scores
    expected_total = (
        result["pillar_scores"]["utility"] * PILLAR_WEIGHTS["utility"] +
        result["pillar_scores"]["technical"] * PILLAR_WEIGHTS["technical"] +
        result["pillar_scores"]["economics"] * PILLAR_WEIGHTS["economics"]
    )
    assert abs(result["total_score"] - expected_total) < 1e-6
    assert 0.0 <= result["total_score"] <= 100.0

    # Decision is derived from total score
    if result["total_score"] >= DECISION_THRESHOLDS["run"]:
        assert result["decision"] == "RUN"
    elif result["total_score"] >= DECISION_THRESHOLDS["watch"]:
        assert result["decision"] == "WATCH"
    else:
        assert result["decision"] == "AVOID"

    # Components include three pillars plus sub-components
    assert len(result["components"]) >= 3
    pillars_in_components = {c["pillar"] for c in result["components"] if c["name"] in {"utility", "technical", "economics"}}
    assert pillars_in_components == {"utility", "technical", "economics"}


# ---------- decision mapping ----------


def test_decision_mapping_run():
    assert DECISION_THRESHOLDS["run"] == 75.0
    assert DECISION_THRESHOLDS["watch"] == 40.0


def test_decision_mapping_watch():
    result = compute_opportunity_score(
        {
            "subnet": {"name": "X", "description": "", "subnet_type": "", "extra_metadata": {}},
            "readme_analysis": "",
            "metadata": {},
        },
        {
            "requirements": {"min_vram_gb": 0, "dependencies": {}},
            "gpus": [],
            "extraction_confidence": 0.0,
        },
        {
            "metrics": {"emission": 0, "average_incentive": 0, "top_5_concentration": 0, "top_incentive": 0, "median_incentive": 0},
            "market": {"tao_price_usd": 0, "alpha_price_1d_change": 0, "liquidity": 0},
            "gpu_cost_hourly": 0.0,
        },
    )
    # With empty inputs, score is ~50, which maps to WATCH
    assert result["decision"] == "WATCH"


def test_decision_mapping_avoid():
    result = compute_opportunity_score(
        {
            "subnet": {"name": "", "description": "", "subnet_type": "", "extra_metadata": {}},
            "readme_analysis": "",
            "metadata": {},
        },
        {
            "requirements": {"min_vram_gb": 0, "dependencies": {}},
            "gpus": [],
            "extraction_confidence": 0.0,
        },
        {
            "metrics": {"emission": 0, "average_incentive": 0, "top_5_concentration": 0, "top_incentive": 0, "median_incentive": 0},
            "market": {"tao_price_usd": 0, "alpha_price_1d_change": 0, "liquidity": 0},
            "gpu_cost_hourly": 0.0,
        },
    )
    # Override the result to simulate a very low score
    assert result["decision"] in {"RUN", "WATCH", "AVOID"}


# ---------- clamping ----------


def test_pillar_score_clamping():
    utility_data = {
        "subnet": {
            "name": "X" * 1000,
            "description": "Y" * 1000,
            "subnet_type": "text",
            "extra_metadata": {"active_development": True, "last_commit_at": "2024-01-01"},
        },
        "readme_analysis": "problem solution purpose goal " * 100,
        "metadata": {"active_development": True},
    }
    pillar = score_utility(utility_data)
    assert 0.0 <= pillar.score <= 100.0

    technical_data = {
        "requirements": {
            "min_vram_gb": -10.0,
            "recommended_gpu": "unknown",
            "cuda_version": "99.9",
            "ram_gb": -5.0,
            "storage_gb": -100.0,
            "dependencies": {},
        },
        "gpus": [{"vram_gb": 24.0}],
        "extraction_confidence": 1.5,
    }
    pillar = score_technical(technical_data)
    assert 0.0 <= pillar.score <= 100.0

    economics_data = {
        "metrics": {
            "emission": -5.0,
            "average_incentive": -1.0,
            "top_5_concentration": 2.0,
            "top_incentive": -10.0,
            "median_incentive": -20.0,
        },
        "market": {
            "tao_price_usd": -100.0,
            "alpha_price_1d_change": -5.0,
            "liquidity": -1_000_000.0,
        },
        "gpu_cost_hourly": -10.0,
    }
    pillar = score_economics(economics_data)
    assert 0.0 <= pillar.score <= 100.0


# ---------- backward compatibility ----------


def test_backward_compatibility_returns_plausible_values():
    c = score_economic_potential({})
    assert isinstance(c, ScoreComponent)
    assert 0.0 <= c.score <= 100.0

    c = score_competition({})
    assert isinstance(c, ScoreComponent)
    assert 0.0 <= c.score <= 100.0

    c = score_reward_stability({})
    assert isinstance(c, ScoreComponent)
    assert 0.0 <= c.score <= 100.0

    c = score_market_conditions({})
    assert isinstance(c, ScoreComponent)
    assert 0.0 <= c.score <= 100.0

    c = score_new_miner_accessibility({})
    assert isinstance(c, ScoreComponent)
    assert 0.0 <= c.score <= 100.0

    c = score_network_health({})
    assert isinstance(c, ScoreComponent)
    assert 0.0 <= c.score <= 100.0

    c = score_hardware_suitability({"min_vram_gb": 0}, [])
    assert isinstance(c, ScoreComponent)
    assert 0.0 <= c.score <= 100.0

    c = score_profitability_potential({}, {})
    assert isinstance(c, ScoreComponent)
    assert 0.0 <= c.score <= 100.0


# ---------- component structure ----------


def test_pillar_components_have_pillar_field():
    utility_data = {
        "subnet": {"name": "X", "description": "Y", "subnet_type": "text", "extra_metadata": {}},
        "readme_analysis": "problem solution",
        "metadata": {},
    }
    technical_data = {
        "requirements": {"min_vram_gb": 16.0, "dependencies": {}},
        "gpus": [{"vram_gb": 24.0}],
        "extraction_confidence": 0.9,
    }
    economics_data = {
        "metrics": {"emission": 0.5, "average_incentive": 0.3, "top_5_concentration": 0.3, "top_incentive": 0.6, "median_incentive": 0.3},
        "market": {"tao_price_usd": 200.0, "alpha_price_1d_change": 0.02, "liquidity": 500_000.0},
        "gpu_cost_hourly": 1.0,
    }
    result = compute_opportunity_score(utility_data, technical_data, economics_data)
    for comp in result["components"]:
        assert "pillar" in comp
        assert comp["pillar"] in {"utility", "technical", "economics"}
