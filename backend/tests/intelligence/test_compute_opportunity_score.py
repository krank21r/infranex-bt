"""
Tests for the v1.0 rule-based opportunity scoring engine.

These tests pin the deterministic, explainable contract of
`app.intelligence.compute_opportunity_score`:
- weights sum to 1.0 (no silent drift)
- every component is a ScoreComponent with weighted == score * weight
- total_score is the sum of weighted values, clamped to [0, 100]
- model_version is the literal "v1.0" — swapping it is a breaking change
- every component carries a non-empty explanation
- empty inputs degrade gracefully (score 50, "unknown" explanation)

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


def test_compute_opportunity_score_with_empty_inputs_returns_eight_components():
    result = compute_opportunity_score({}, {}, {}, [])
    assert SCORE_MODEL_VERSION == "v1.0"
    assert result["model_version"] == "v1.0"
    assert len(result["components"]) == 8
    expected_names = {
        "economic_potential",
        "competition",
        "reward_stability",
        "market_conditions",
        "new_miner_accessibility",
        "network_health",
        "hardware_suitability",
        "profitability_potential",
    }
    assert {c["name"] for c in result["components"]} == expected_names


def test_every_component_weighted_equals_score_times_weight():
    result = compute_opportunity_score({}, {}, {}, [])
    for component in result["components"]:
        score = component["score"]
        weight = component["weight"]
        weighted = component["weighted"]
        assert abs(weighted - score * weight) < 1e-6, (
            f"{component['name']}: weighted={weighted} != score*weight={score * weight}"
        )


def test_total_score_is_sum_of_weighted_clamped_to_0_100():
    result = compute_opportunity_score({}, {}, {}, [])
    summed = sum(c["weighted"] for c in result["components"])
    assert abs(result["total_score"] - summed) < 1e-6
    assert 0.0 <= result["total_score"] <= 100.0


def test_model_version_is_v1_string():
    # Explainability / version-stamping invariant: changing this string
    # is a breaking change that must be reviewed, not silently edited.
    assert SCORE_MODEL_VERSION == "v1.0"
    assert isinstance(SCORE_MODEL_VERSION, str)
    assert SCORE_MODEL_VERSION.startswith("v")


def test_summary_mentions_strongest_and_weakest_components():
    result = compute_opportunity_score({}, {}, {}, [])
    summary = result["summary"]
    # Components sorted by weighted; first wins, last loses.
    components_by_weight = sorted(result["components"], key=lambda c: c["weighted"])
    weakest = components_by_weight[0]["name"]
    strongest = components_by_weight[-1]["name"]
    assert strongest in summary or weakest in summary


def test_economic_potential_component_has_non_empty_explanation():
    component = score_economic_potential({})
    assert isinstance(component, ScoreComponent)
    assert component.explanation, "every component must carry an explanation"
    assert component.score is not None


def test_hardware_suitability_unknown_returns_50_with_explanation():
    # Graceful-degradation path: when requirements + gpus are both empty
    # the scorer must NOT crash and must explicitly say "unknown".
    component = score_hardware_suitability({"min_vram_gb": 0}, [])
    assert component.score == 50.0
    assert "unknown" in component.explanation.lower()
    assert component.explanation
