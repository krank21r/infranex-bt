"""
Intelligence Engine — rule-based, explainable subnet opportunity scoring.

This is the v1.0 scorer. Every component is deterministic and explainable.
Per the spec:
  - "Do not claim that a score guarantees profit."
  - "All scoring logic belongs in backend services."
  - "Store: score, component scores, weights, timestamp, model version"
  - "Start with explainable rule-based scoring. Later support ML models."
"""
from dataclasses import dataclass
from typing import Dict, Any, List
from decimal import Decimal


SCORE_MODEL_VERSION = "v1.0"


@dataclass
class ScoreComponent:
    name: str
    score: float  # 0-100
    weight: float
    weighted: float
    explanation: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "score": round(self.score, 2),
            "weight": self.weight,
            "weighted": round(self.weighted, 2),
            "explanation": self.explanation,
        }


# Default weights — must sum to 1.0
DEFAULT_WEIGHTS: Dict[str, float] = {
    "economic_potential": 0.20,
    "competition": 0.15,
    "reward_stability": 0.15,
    "market_conditions": 0.10,
    "new_miner_accessibility": 0.10,
    "network_health": 0.10,
    "hardware_suitability": 0.10,
    "profitability_potential": 0.10,
}


def _clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, value))


def score_economic_potential(metrics: Dict[str, Any]) -> ScoreComponent:
    """How much reward per neuron / stake, in absolute terms."""
    emission = float(metrics.get("emission") or 0)
    avg_incentive = float(metrics.get("average_incentive") or 0)
    total_stake = float(metrics.get("total_stake") or 0)

    # Higher emission, higher incentive, lower stake = better
    raw = (emission * 10) + (avg_incentive * 100) - (total_stake / 1e6)
    score = _clamp(50 + raw)

    return ScoreComponent(
        name="economic_potential",
        score=score,
        weight=DEFAULT_WEIGHTS["economic_potential"],
        weighted=score * DEFAULT_WEIGHTS["economic_potential"],
        explanation=(
            f"Emission {emission:.4f} α/block, average incentive "
            f"{avg_incentive:.4f}, total stake {total_stake:,.0f} α. "
            "Score rewards high emission and incentive per neuron."
        ),
    )


def score_competition(metrics: Dict[str, Any]) -> ScoreComponent:
    """Lower top-concentration + healthier participation = better for new miners."""
    top5 = float(metrics.get("top_5_concentration") or 0)
    top10 = float(metrics.get("top_10_concentration") or 0)
    turnover = float(metrics.get("miner_turnover") or 0)
    util = float(metrics.get("neuron_utilization") or 0)

    # Lower top5% concentration = better. Higher utilization = better.
    score = _clamp(100 - (top5 * 60) - (top10 * 30) + (util * 20) + (turnover * 20))

    if top5 > 0.5:
        explanation = (
            f"High competition. Top-5 miners hold {top5*100:.1f}% of incentive; "
            "concentrated distribution may limit new miner earnings."
        )
    elif top5 > 0.3:
        explanation = (
            f"Moderate competition. Top-5 concentration {top5*100:.1f}%, "
            "recent miners are showing measurable participation."
        )
    else:
        explanation = (
            f"Healthy competition. Top-5 concentration only {top5*100:.1f}%; "
            "incentive distribution is relatively wide."
        )

    return ScoreComponent(
        name="competition",
        score=score,
        weight=DEFAULT_WEIGHTS["competition"],
        weighted=score * DEFAULT_WEIGHTS["competition"],
        explanation=explanation,
    )


def score_reward_stability(metrics: Dict[str, Any]) -> ScoreComponent:
    """Stability based on top vs median incentive spread."""
    top = float(metrics.get("top_incentive") or 0)
    median = float(metrics.get("median_incentive") or 0)
    avg = float(metrics.get("average_incentive") or 0)

    if avg <= 0:
        score = 50.0
        explanation = "Insufficient data to evaluate reward stability."
    else:
        spread = (top - median) / max(avg, 1e-9)
        score = _clamp(100 - spread * 30)
        explanation = (
            f"Top incentive {top:.4f} vs median {median:.4f} (avg {avg:.4f}). "
            f"Spread ratio {spread:.2f}; lower spread = more predictable rewards."
        )

    return ScoreComponent(
        name="reward_stability",
        score=score,
        weight=DEFAULT_WEIGHTS["reward_stability"],
        weighted=score * DEFAULT_WEIGHTS["reward_stability"],
        explanation=explanation,
    )


def score_market_conditions(market: Dict[str, Any]) -> ScoreComponent:
    """TAO price + liquidity + 24h volume as proxy for market health."""
    price_change_24h = float(market.get("alpha_price_1d_change") or 0)
    liquidity = float(market.get("liquidity") or 0)
    volume_mcap = float(market.get("volume_market_cap_ratio") or 0)

    score = _clamp(50 + (price_change_24h * 2) + (volume_mcap * 100) + (liquidity / 1e4))

    explanation = (
        f"24h price change {price_change_24h*100:+.2f}%, "
        f"volume/market-cap ratio {volume_mcap*100:.2f}%, "
        f"liquidity {liquidity:,.0f}."
    )

    return ScoreComponent(
        name="market_conditions",
        score=score,
        weight=DEFAULT_WEIGHTS["market_conditions"],
        weighted=score * DEFAULT_WEIGHTS["market_conditions"],
        explanation=explanation,
    )


def score_new_miner_accessibility(metrics: Dict[str, Any]) -> ScoreComponent:
    """Registration cost + utilization proxy for how hard it is to join."""
    reg_cost = float(metrics.get("registration_cost") or 0)
    util = float(metrics.get("neuron_utilization") or 0)
    miner_count = float(metrics.get("miner_count") or 0)

    # Higher reg cost = harder. Higher util = more competition.
    score = _clamp(100 - (reg_cost / 100) - (util * 20) - (miner_count / 50))

    explanation = (
        f"Registration cost {reg_cost:.2f} α, "
        f"utilization {util*100:.1f}%, miner count {miner_count:.0f}. "
        "Lower cost and lower utilization = easier for new miners."
    )

    return ScoreComponent(
        name="new_miner_accessibility",
        score=score,
        weight=DEFAULT_WEIGHTS["new_miner_accessibility"],
        weighted=score * DEFAULT_WEIGHTS["new_miner_accessibility"],
        explanation=explanation,
    )


def score_network_health(metrics: Dict[str, Any]) -> ScoreComponent:
    """Trust + consensus + validator count as a stability proxy."""
    trust = float(metrics.get("trust") or 0)
    consensus = float(metrics.get("consensus") or 0)
    validators = float(metrics.get("validator_count") or 0)

    score = _clamp((trust * 50) + (consensus * 30) + min(validators, 128) / 128 * 20)

    explanation = (
        f"Trust {trust:.3f}, consensus {consensus:.3f}, validators {validators:.0f}. "
        "Higher trust/consensus and more validators = healthier network."
    )

    return ScoreComponent(
        name="network_health",
        score=score,
        weight=DEFAULT_WEIGHTS["network_health"],
        weighted=score * DEFAULT_WEIGHTS["network_health"],
        explanation=explanation,
    )


def score_hardware_suitability(requirements: Dict[str, Any], gpus: List[Dict[str, Any]]) -> ScoreComponent:
    """% of catalog GPUs that meet minimum requirements."""
    min_vram = float(requirements.get("min_vram_gb") or 0)
    if min_vram <= 0 or not gpus:
        return ScoreComponent(
            name="hardware_suitability",
            score=50.0,
            weight=DEFAULT_WEIGHTS["hardware_suitability"],
            weighted=50.0 * DEFAULT_WEIGHTS["hardware_suitability"],
            explanation="Subnet requirements unknown — cannot evaluate hardware suitability.",
        )

    eligible = [g for g in gpus if float(g.get("vram_gb") or 0) >= min_vram]
    pct = len(eligible) / max(len(gpus), 1) * 100
    score = _clamp(pct)

    explanation = (
        f"Subnet requires {min_vram:.0f} GB VRAM. "
        f"{len(eligible)} of {len(gpus)} catalog GPUs qualify ({pct:.0f}%)."
    )

    return ScoreComponent(
        name="hardware_suitability",
        score=score,
        weight=DEFAULT_WEIGHTS["hardware_suitability"],
        weighted=score * DEFAULT_WEIGHTS["hardware_suitability"],
        explanation=explanation,
    )


def score_profitability_potential(metrics: Dict[str, Any], market: Dict[str, Any]) -> ScoreComponent:
    """Coarse revenue / cost estimate. Returns a heuristic 0-100 score."""
    emission = float(metrics.get("emission") or 0)
    avg_incentive = float(metrics.get("average_incentive") or 0)
    tao_usd = float(market.get("tao_price_usd") or 0) or 100.0
    blocks_per_day = 7200  # Bittensor ~7.2k blocks/day

    daily_alpha = emission * blocks_per_day
    revenue_per_day = daily_alpha * avg_incentive * tao_usd
    # Heuristic: assume a miner captures avg_incentive share
    score = _clamp(40 + (revenue_per_day / 50))  # $50/day = +60 score

    explanation = (
        f"Estimated gross daily revenue ${revenue_per_day:.2f} at current TAO ${tao_usd:.2f}. "
        "Profitability requires netting GPU cost, registration burn, and uptime."
    )

    return ScoreComponent(
        name="profitability_potential",
        score=score,
        weight=DEFAULT_WEIGHTS["profitability_potential"],
        weighted=score * DEFAULT_WEIGHTS["profitability_potential"],
        explanation=explanation,
    )


def compute_opportunity_score(
    metrics: Dict[str, Any],
    market: Dict[str, Any],
    requirements: Dict[str, Any],
    gpus: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Return total score (0-100), per-component breakdown, and summary text."""
    components = [
        score_economic_potential(metrics),
        score_competition(metrics),
        score_reward_stability(metrics),
        score_market_conditions(market),
        score_new_miner_accessibility(metrics),
        score_network_health(metrics),
        score_hardware_suitability(requirements, gpus),
        score_profitability_potential(metrics, market),
    ]

    total = sum(c.weighted for c in components)
    total = _clamp(total)

    summary = (
        f"Opportunity Score {total:.0f}/100 (model {SCORE_MODEL_VERSION}). "
        "Analytical estimate — not guaranteed profit. "
        f"Strongest factor: {max(components, key=lambda c: c.score).name.replace('_', ' ')}. "
        f"Weakest factor: {min(components, key=lambda c: c.score).name.replace('_', ' ')}."
    )

    return {
        "total_score": total,
        "model_version": SCORE_MODEL_VERSION,
        "components": [c.to_dict() for c in components],
        "summary": summary,
    }
