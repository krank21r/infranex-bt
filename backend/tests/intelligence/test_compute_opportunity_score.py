"""
Tests for the v2.0 rule-based opportunity scoring engine.

Pins the deterministic, explainable contract of
`app.intelligence.compute_opportunity_score`:
- weights sum to 1.0 (no silent drift)
- three pillars: utility, technical, economics
- total_score is clamped to [0, 100]
- model_version is the literal "v2.0"
- decision maps correctly from score bands
- every pillar carries a non-empty explanation

Pure Python — no DB, no async.
"""
from app.intelligence import (
    DEFAULT_WEIGHTS,
    SCORE_MODEL_VERSION,
    ScoreComponent,
    compute_opportunity_score,
    score_economic_potential,
    score_hardware_suitability,
)


def test_default_weights_sum_to_exactly_one():
    total = sum(DEFAULT_WEIGHTS.values())
    assert abs(total - 1.0) < 1e-9, f"weights sum to {total}, not 1.0"


def test_compute_opportunity_score_with_empty_inputs_returns_three_pillars():
    result = compute_opportunity_score({}, {}, {})
    assert SCORE_MODEL_VERSION == "v2.0"
    assert result["model_version"] == "v2.0"
    assert len(result["components"]) >= 3
    expected_names = {"utility", "technical", "economics"}
    assert {c["name"] for c in result["components"] if c["name"] in expected_names} == expected_names


def test_total_score_is_weighted_pillars_clamped_to_0_100():
    result = compute_opportunity_score({}, {}, {})
    assert 0.0 <= result["total_score"] <= 100.0


def test_model_version_is_v2_string():
    assert SCORE_MODEL_VERSION == "v2.0"
    assert isinstance(SCORE_MODEL_VERSION, str)
    assert SCORE_MODEL_VERSION.startswith("v")


def test_decision_mapping_run_threshold():
    utility = {
        "subnet": {
            "name": "A" * 10,
            "description": "A" * 300,
            "subnet_type": "ai",
            "metadata": {"active_development": True},
        },
        "readme_analysis": "## Problem\nWe solve X." * 50,
        "metadata": {},
    }
    technical = {
        "requirements": {"min_vram_gb": 0, "cuda_version": "12.0", "ram_gb": 32, "storage_gb": 100, "dependencies": {}},
        "gpus": [{"vram_gb": 80}],
        "extraction_confidence": 1.0,
    }
    economics = {
        "metrics": {
            "emission": 1.0, "average_incentive": 0.5, "total_stake": 0,
            "top_5_concentration": 0.1, "top_10_concentration": 0.2,
            "miner_turnover": 0.1, "neuron_utilization": 0.5,
            "top_incentive": 0.6, "median_incentive": 0.4,
            "trust": 0.9, "consensus": 0.9, "validator_count": 100,
            "registration_cost": 0, "miner_count": 10,
        },
        "market": {"tao_price_usd": 1000, "alpha_price_1d_change": 0.05, "liquidity": 1000000, "volume_market_cap_ratio": 0.1},
        "gpu_cost_hourly": 0.0,
    }
    result = compute_opportunity_score(utility, technical, economics)
    assert result["decision"] == "RUN"


def test_decision_mapping_watch_threshold():
    utility = {
        "subnet": {"name": "ok", "description": "ok", "subnet_type": "", "metadata": {}},
        "readme_analysis": "",
        "metadata": {},
    }
    technical = {
        "requirements": {"min_vram_gb": 0, "cuda_version": "12.0", "ram_gb": 32, "storage_gb": 100, "dependencies": {}},
        "gpus": [{"vram_gb": 80}],
        "extraction_confidence": 0.8,
    }
    economics = {
        "metrics": {
            "emission": 0.1, "average_incentive": 0.1, "total_stake": 100000,
            "top_5_concentration": 0.5, "top_10_concentration": 0.7,
            "miner_turnover": 0.1, "neuron_utilization": 0.5,
            "top_incentive": 0.2, "median_incentive": 0.1,
            "trust": 0.3, "consensus": 0.3, "validator_count": 10,
            "registration_cost": 100, "miner_count": 50,
        },
        "market": {"tao_price_usd": 50, "alpha_price_1d_change": -0.02, "liquidity": 50000, "volume_market_cap_ratio": 0.05},
        "gpu_cost_hourly": 5.0,
    }
    result = compute_opportunity_score(utility, technical, economics)
    assert result["decision"] == "WATCH"


def test_decision_mapping_avoid_threshold():
    utility = {"subnet": {"name": "", "description": "", "subnet_type": "", "metadata": {}}, "readme_analysis": "", "metadata": {}}
    technical = {"requirements": {"min_vram_gb": 0}, "gpus": [], "extraction_confidence": 0.0}
    economics = {"metrics": {"emission": 0, "average_incentive": 0, "total_stake": 0, "top_5_concentration": 1.0, "top_10_concentration": 1.0, "miner_turnover": 0, "neuron_utilization": 1.0, "top_incentive": 0, "median_incentive": 0, "trust": 0, "consensus": 0, "validator_count": 0, "registration_cost": 9999, "miner_count": 9999}, "market": {"tao_price_usd": 0, "alpha_price_1d_change": -1.0, "liquidity": 0, "volume_market_cap_ratio": 0.0}, "gpu_cost_hourly": 100.0}
    result = compute_opportunity_score(utility, technical, economics)
    assert result["decision"] == "AVOID"


def test_pillar_scores_present_in_result():
    result = compute_opportunity_score({}, {}, {})
    assert "pillar_scores" in result
    assert "utility" in result["pillar_scores"]
    assert "technical" in result["pillar_scores"]
    assert "economics" in result["pillar_scores"]
    assert result["weights"]["utility"] == 0.30
    assert result["weights"]["technical"] == 0.35
    assert result["weights"]["economics"] == 0.35


def test_every_pillar_has_non_empty_explanation():
    result = compute_opportunity_score({}, {}, {})
    for comp in result["components"]:
        assert comp["explanation"], f"every component must carry an explanation, got {comp['name']}"


def test_economic_potential_component_has_non_empty_explanation():
    component = score_economic_potential({})
    assert isinstance(component, ScoreComponent)
    assert component.explanation, "every component must carry an explanation"
    assert component.score is not None


def test_hardware_suitability_unknown_returns_50_with_explanation():
    component = score_hardware_suitability({"min_vram_gb": 0}, [])
    assert component.score == 50.0
    assert "unknown" in component.explanation.lower()
    assert component.explanation
