"""
Intelligence Engine — rule-based, explainable subnet opportunity scoring.

v2.0 uses a 3-pillar model:
  - Utility (30%): What does the subnet do? Is it useful?
  - Technical (35%): Can we run it? What hardware is needed?
  - Economics (35%): Will it be profitable?

Per the spec:
  - "Do not claim that a score guarantees profit."
  - "All scoring logic belongs in backend services."
  - "Store: score, component scores, weights, timestamp, model version"
"""
from dataclasses import dataclass
from typing import Dict, Any, List

SCORE_MODEL_VERSION = "v2.0"

PILLAR_WEIGHTS = {
    "utility": 0.30,
    "technical": 0.35,
    "economics": 0.35,
}

DECISION_THRESHOLDS = {
    "run": 75.0,
    "watch": 40.0,
}


@dataclass
class ScoreComponent:
    name: str
    score: float
    weight: float
    weighted: float
    explanation: str
    pillar: str = ""
    components: List[Dict[str, Any]] | None = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "score": round(self.score, 2),
            "weight": self.weight,
            "weighted": round(self.weighted, 2),
            "explanation": self.explanation,
            "pillar": self.pillar,
            "components": self.components or [],
        }


def _clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, value))


def _to_float(value) -> float:
    try:
        return float(value) if value is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


DEFAULT_WEIGHTS = {
    "economic_potential": 0.20,
    "competition": 0.15,
    "reward_stability": 0.15,
    "market_conditions": 0.10,
    "new_miner_accessibility": 0.10,
    "network_health": 0.10,
    "hardware_suitability": 0.10,
    "profitability_potential": 0.10,
}


def score_economic_potential(metrics: Dict[str, Any]) -> ScoreComponent:
    emission = float(metrics.get("emission") or 0)
    avg_incentive = float(metrics.get("average_incentive") or 0)
    total_stake = float(metrics.get("total_stake") or 0)
    raw = (emission * 10) + (avg_incentive * 100) - (total_stake / 1e6)
    score = _clamp(50 + raw)
    return ScoreComponent(
        name="economic_potential",
        score=score,
        weight=DEFAULT_WEIGHTS["economic_potential"],
        weighted=score * DEFAULT_WEIGHTS["economic_potential"],
        explanation=f"Emission {emission:.4f} α/block, average incentive {avg_incentive:.4f}, total stake {total_stake:,.0f} α. Score rewards high emission and incentive per neuron.",
        pillar="economics",
    )


def score_competition(metrics: Dict[str, Any]) -> ScoreComponent:
    top5 = float(metrics.get("top_5_concentration") or 0)
    top10 = float(metrics.get("top_10_concentration") or 0)
    turnover = float(metrics.get("miner_turnover") or 0)
    util = float(metrics.get("neuron_utilization") or 0)
    score = _clamp(100 - (top5 * 60) - (top10 * 30) + (util * 20) + (turnover * 20))
    if top5 > 0.5:
        explanation = f"High competition. Top-5 miners hold {top5*100:.1f}% of incentive; concentrated distribution may limit new miner earnings."
    elif top5 > 0.3:
        explanation = f"Moderate competition. Top-5 concentration {top5*100:.1f}%, recent miners are showing measurable participation."
    else:
        explanation = f"Healthy competition. Top-5 concentration only {top5*100:.1f}%; incentive distribution is relatively wide."
    return ScoreComponent(
        name="competition",
        score=score,
        weight=DEFAULT_WEIGHTS["competition"],
        weighted=score * DEFAULT_WEIGHTS["competition"],
        explanation=explanation,
        pillar="economics",
    )


def score_reward_stability(metrics: Dict[str, Any]) -> ScoreComponent:
    top = float(metrics.get("top_incentive") or 0)
    median = float(metrics.get("median_incentive") or 0)
    avg = float(metrics.get("average_incentive") or 0)
    if avg <= 0:
        score = 50.0
        explanation = "Insufficient data to evaluate reward stability."
    else:
        spread = (top - median) / max(avg, 1e-9)
        score = _clamp(100 - spread * 30)
        explanation = f"Top incentive {top:.4f} vs median {median:.4f} (avg {avg:.4f}). Spread ratio {spread:.2f}; lower spread = more predictable rewards."
    return ScoreComponent(
        name="reward_stability",
        score=score,
        weight=DEFAULT_WEIGHTS["reward_stability"],
        weighted=score * DEFAULT_WEIGHTS["reward_stability"],
        explanation=explanation,
        pillar="economics",
    )


def score_market_conditions(market: Dict[str, Any]) -> ScoreComponent:
    price_change_24h = float(market.get("alpha_price_1d_change") or 0)
    liquidity = float(market.get("liquidity") or 0)
    volume_mcap = float(market.get("volume_market_cap_ratio") or 0)
    score = _clamp(50 + (price_change_24h * 2) + (volume_mcap * 100) + (liquidity / 1e4))
    explanation = f"24h price change {price_change_24h*100:+.2f}%, volume/market-cap ratio {volume_mcap*100:.2f}%, liquidity {liquidity:,.0f}."
    return ScoreComponent(
        name="market_conditions",
        score=score,
        weight=DEFAULT_WEIGHTS["market_conditions"],
        weighted=score * DEFAULT_WEIGHTS["market_conditions"],
        explanation=explanation,
        pillar="economics",
    )


def score_new_miner_accessibility(metrics: Dict[str, Any]) -> ScoreComponent:
    reg_cost = float(metrics.get("registration_cost") or 0)
    util = float(metrics.get("neuron_utilization") or 0)
    miner_count = float(metrics.get("miner_count") or 0)
    score = _clamp(100 - (reg_cost / 100) - (util * 20) - (miner_count / 50))
    explanation = f"Registration cost {reg_cost:.2f} α, utilization {util*100:.1f}%, miner count {miner_count:.0f}. Lower cost and lower utilization = easier for new miners."
    return ScoreComponent(
        name="new_miner_accessibility",
        score=score,
        weight=DEFAULT_WEIGHTS["new_miner_accessibility"],
        weighted=score * DEFAULT_WEIGHTS["new_miner_accessibility"],
        explanation=explanation,
        pillar="economics",
    )


def score_network_health(metrics: Dict[str, Any]) -> ScoreComponent:
    trust = float(metrics.get("trust") or 0)
    consensus = float(metrics.get("consensus") or 0)
    validators = float(metrics.get("validator_count") or 0)
    score = _clamp((trust * 50) + (consensus * 30) + min(validators, 128) / 128 * 20)
    explanation = f"Trust {trust:.3f}, consensus {consensus:.3f}, validators {validators:.0f}. Higher trust/consensus and more validators = healthier network."
    return ScoreComponent(
        name="network_health",
        score=score,
        weight=DEFAULT_WEIGHTS["network_health"],
        weighted=score * DEFAULT_WEIGHTS["network_health"],
        explanation=explanation,
        pillar="economics",
    )


def score_hardware_suitability(requirements: Dict[str, Any], gpus: List[Dict[str, Any]]) -> ScoreComponent:
    min_vram = float(requirements.get("min_vram_gb") or 0)
    if min_vram <= 0 or not gpus:
        return ScoreComponent(
            name="hardware_suitability",
            score=50.0,
            weight=DEFAULT_WEIGHTS["hardware_suitability"],
            weighted=50.0 * DEFAULT_WEIGHTS["hardware_suitability"],
            explanation="Subnet requirements unknown — cannot evaluate hardware suitability.",
            pillar="technical",
        )
    eligible = [g for g in gpus if float(g.get("vram_gb") or 0) >= min_vram]
    pct = len(eligible) / max(len(gpus), 1) * 100
    score = _clamp(pct)
    explanation = f"Subnet requires {min_vram:.0f} GB VRAM. {len(eligible)} of {len(gpus)} catalog GPUs qualify ({pct:.0f}%)."
    return ScoreComponent(
        name="hardware_suitability",
        score=score,
        weight=DEFAULT_WEIGHTS["hardware_suitability"],
        weighted=score * DEFAULT_WEIGHTS["hardware_suitability"],
        explanation=explanation,
        pillar="technical",
    )


def score_profitability_potential(metrics: Dict[str, Any], market: Dict[str, Any]) -> ScoreComponent:
    emission = float(metrics.get("emission") or 0)
    avg_incentive = float(metrics.get("average_incentive") or 0)
    tao_usd = float(market.get("tao_price_usd") or 0) or 100.0
    blocks_per_day = 7200
    daily_alpha = emission * blocks_per_day
    revenue_per_day = daily_alpha * avg_incentive * tao_usd
    score = _clamp(40 + (revenue_per_day / 50))
    explanation = f"Estimated gross daily revenue ${revenue_per_day:.2f} at current TAO ${tao_usd:.2f}. Profitability requires netting GPU cost, registration burn, and uptime."
    return ScoreComponent(
        name="profitability_potential",
        score=score,
        weight=DEFAULT_WEIGHTS["profitability_potential"],
        weighted=score * DEFAULT_WEIGHTS["profitability_potential"],
        explanation=explanation,
        pillar="economics",
    )


def score_utility(utility_data: Dict[str, Any]) -> ScoreComponent:
    subnet = utility_data.get("subnet", {})
    readme = utility_data.get("readme_analysis", "") or ""
    metadata = utility_data.get("metadata", {}) or {}

    name = (subnet.get("name") or "").strip()
    description = (subnet.get("description") or "").strip()
    category = (subnet.get("subnet_type") or "").strip()

    name_score = 0.0
    if name:
        name_score += 10.0
    if len(name) > 3:
        name_score += 5.0

    desc_score = 0.0
    if description:
        desc_score += 10.0
    if len(description) > 50:
        desc_score += 5.0
    if len(description) > 200:
        desc_score += 5.0

    readme_score = 0.0
    if readme:
        readme_score += 15.0
    if len(readme) > 200:
        readme_score += 10.0
    if any(kw in readme.lower() for kw in ["problem", "solution", "purpose", "goal"]):
        readme_score += 5.0

    meta_score = 0.0
    if metadata:
        meta_score += 10.0
    if metadata.get("active_development") or metadata.get("last_commit_at"):
        meta_score += 5.0
    if category:
        meta_score += 5.0

    score = _clamp(name_score + desc_score + readme_score + meta_score)
    explanation = (
        f"Subnet '{name or 'unknown'}' {('categorized as ' + category) if category else 'no category'}. "
        f"Description length {len(description)} chars, README length {len(readme)} chars. "
        f"Utility score reflects clarity, documentation depth, and metadata richness."
    )
    return ScoreComponent(
        name="utility",
        score=score,
        weight=PILLAR_WEIGHTS["utility"],
        weighted=score * PILLAR_WEIGHTS["utility"],
        explanation=explanation,
        pillar="utility",
    )


def score_technical(technical_data: Dict[str, Any]) -> ScoreComponent:
    requirements = technical_data.get("requirements", {}) or {}
    gpus = technical_data.get("gpus", []) or []
    extraction_confidence = _to_float(technical_data.get("extraction_confidence"))

    min_vram = _to_float(requirements.get("min_vram_gb"))
    recommended_gpu = (requirements.get("recommended_gpu") or "").lower()
    cuda_version = (requirements.get("cuda_version") or "").strip()
    ram_gb = _to_float(requirements.get("ram_gb"))
    storage_gb = _to_float(requirements.get("storage_gb"))
    dependencies = requirements.get("dependencies", {}) or {}
    dep_count = len(dependencies) if isinstance(dependencies, dict) else 0

    gpu_match = 50.0
    if min_vram > 0 and gpus:
        eligible = [g for g in gpus if _to_float(g.get("vram_gb")) >= min_vram]
        gpu_match = _clamp(len(eligible) / max(len(gpus), 1) * 100)

    dep_simplicity = _clamp(100 - (dep_count * 5))

    cuda_score = 50.0
    if cuda_version:
        try:
            major = float(cuda_version.split(".")[0])
            if major >= 11:
                cuda_score = 100.0
            elif major >= 10:
                cuda_score = 80.0
            else:
                cuda_score = 50.0
        except (ValueError, IndexError):
            cuda_score = 50.0

    ram_score = 100.0 if ram_gb >= 32 else (80.0 if ram_gb >= 16 else 50.0) if ram_gb > 0 else 50.0
    storage_score = 100.0 if storage_gb >= 100 else (80.0 if storage_gb >= 50 else 50.0) if storage_gb > 0 else 50.0
    resource_score = (ram_score + storage_score) / 2

    data_confidence = extraction_confidence * 100

    components = [
        ScoreComponent(name="gpu_match_rate", score=gpu_match, weight=0.40, weighted=gpu_match * 0.40, explanation=f"{gpu_match:.0f}% of catalog GPUs meet the {min_vram:.0f} GB VRAM requirement.", pillar="technical"),
        ScoreComponent(name="dependency_simplicity", score=dep_simplicity, weight=0.20, weighted=dep_simplicity * 0.20, explanation=f"{dep_count} dependencies detected; simplicity score penalizes complexity.", pillar="technical"),
        ScoreComponent(name="cuda_compatibility", score=cuda_score, weight=0.15, weighted=cuda_score * 0.15, explanation=f"CUDA version {cuda_version or 'unknown'} compatibility score.", pillar="technical"),
        ScoreComponent(name="resource_feasibility", score=resource_score, weight=0.15, weighted=resource_score * 0.15, explanation=f"RAM {ram_gb:.0f} GB, storage {storage_gb:.0f} GB feasibility.", pillar="technical"),
        ScoreComponent(name="data_confidence", score=data_confidence, weight=0.10, weighted=data_confidence * 0.10, explanation=f"Extraction confidence {extraction_confidence:.2f} from analyzer output.", pillar="technical"),
    ]

    total = sum(c.weighted for c in components)
    total = _clamp(total)
    explanation = (
        f"Technical feasibility {total:.0f}/100. "
        f"GPU match {gpu_match:.0f}%, dependencies {dep_count}, CUDA {cuda_version or 'unknown'}. "
        f"Data confidence {extraction_confidence:.2f}."
    )
    return ScoreComponent(
        name="technical",
        score=total,
        weight=PILLAR_WEIGHTS["technical"],
        weighted=total * PILLAR_WEIGHTS["technical"],
        explanation=explanation,
        pillar="technical",
        components=[c.to_dict() for c in components],
    )


def score_economics(economics_data: Dict[str, Any]) -> ScoreComponent:
    metrics = economics_data.get("metrics", {}) or {}
    market = economics_data.get("market", {}) or {}
    gpu_cost_hourly = _to_float(economics_data.get("gpu_cost_hourly"))

    emission = _to_float(metrics.get("emission"))
    avg_incentive = _to_float(metrics.get("average_incentive"))
    tao_usd = _to_float(market.get("tao_price_usd")) or 100.0
    blocks_per_day = 7200
    daily_alpha = emission * blocks_per_day
    revenue_per_day = daily_alpha * avg_incentive * tao_usd
    revenue_score = _clamp((revenue_per_day / 50) * 100)

    top5 = _to_float(metrics.get("top_5_concentration"))
    competition_score = _clamp(100 - (top5 * 60))

    top = _to_float(metrics.get("top_incentive"))
    median = _to_float(metrics.get("median_incentive"))
    avg = _to_float(metrics.get("average_incentive"))
    spread = (top - median) / max(avg, 1e-9) if avg > 0 else 0
    stability_score = _clamp(100 - spread * 30)

    monthly_cost = gpu_cost_hourly * 730 if gpu_cost_hourly > 0 else 0
    monthly_revenue = revenue_per_day * 30
    cost_efficiency = _clamp((monthly_revenue / max(monthly_cost, 1e-9)) * 100) if monthly_cost > 0 else 50.0

    price_change = _to_float(market.get("alpha_price_1d_change"))
    liquidity = _to_float(market.get("liquidity"))
    momentum_score = _clamp(50 + (price_change * 2) + (liquidity / 1e4))

    components = [
        ScoreComponent(name="revenue_potential", score=revenue_score, weight=0.30, weighted=revenue_score * 0.30, explanation=f"Estimated ${revenue_per_day:.2f}/day at current TAO ${tao_usd:.2f}.", pillar="economics"),
        ScoreComponent(name="competition_health", score=competition_score, weight=0.20, weighted=competition_score * 0.20, explanation=f"Top-5 concentration {top5*100:.1f}% indicates {'high' if top5 > 0.5 else 'moderate' if top5 > 0.3 else 'healthy'} competition.", pillar="economics"),
        ScoreComponent(name="reward_stability", score=stability_score, weight=0.15, weighted=stability_score * 0.15, explanation=f"Spread ratio {spread:.2f}; lower spread means more predictable rewards.", pillar="economics"),
        ScoreComponent(name="cost_efficiency", score=cost_efficiency, weight=0.20, weighted=cost_efficiency * 0.20, explanation=f"GPU cost ${gpu_cost_hourly:.2f}/hr (${monthly_cost:.2f}/mo) vs estimated ${monthly_revenue:.2f}/mo revenue.", pillar="economics"),
        ScoreComponent(name="market_momentum", score=momentum_score, weight=0.15, weighted=momentum_score * 0.15, explanation=f"Price change {price_change*100:+.2f}%, liquidity {liquidity:,.0f}.", pillar="economics"),
    ]

    total = sum(c.weighted for c in components)
    total = _clamp(total)
    explanation = (
        f"Economics viability {total:.0f}/100. "
        f"Revenue ${revenue_per_day:.2f}/day, GPU cost ${gpu_cost_hourly:.2f}/hr, "
        f"competition {'high' if top5 > 0.5 else 'moderate' if top5 > 0.3 else 'healthy'}. "
        f"Market momentum {momentum_score:.0f}."
    )
    return ScoreComponent(
        name="economics",
        score=total,
        weight=PILLAR_WEIGHTS["economics"],
        weighted=total * PILLAR_WEIGHTS["economics"],
        explanation=explanation,
        pillar="economics",
        components=[c.to_dict() for c in components],
    )


def compute_opportunity_score(
    utility_data: Dict[str, Any],
    technical_data: Dict[str, Any],
    economics_data: Dict[str, Any],
) -> Dict[str, Any]:
    utility = score_utility(utility_data)
    technical = score_technical(technical_data)
    economics = score_economics(economics_data)

    total = (
        utility.score * PILLAR_WEIGHTS["utility"] +
        technical.score * PILLAR_WEIGHTS["technical"] +
        economics.score * PILLAR_WEIGHTS["economics"]
    )
    total = _clamp(total)

    if total >= DECISION_THRESHOLDS["run"]:
        decision = "RUN"
    elif total >= DECISION_THRESHOLDS["watch"]:
        decision = "WATCH"
    else:
        decision = "AVOID"

    summary = (
        f"Opportunity Score {total:.0f}/100 — {decision}. "
        f"Utility {utility.score:.0f}, Technical {technical.score:.0f}, Economics {economics.score:.0f}. "
        f"Strongest factor: {max([utility, technical, economics], key=lambda c: c.score).name}. "
        f"Weakest factor: {min([utility, technical, economics], key=lambda c: c.score).name}."
    )

    components = [utility.to_dict(), technical.to_dict(), economics.to_dict()]
    flat_components = []
    for comp in components:
        flat_components.append(comp)
        for sub in comp.get("components", []):
            flat_components.append(sub)

    return {
        "total_score": total,
        "model_version": SCORE_MODEL_VERSION,
        "pillar_scores": {
            "utility": round(utility.score, 2),
            "technical": round(technical.score, 2),
            "economics": round(economics.score, 2),
        },
        "weights": PILLAR_WEIGHTS,
        "decision": decision,
        "components": flat_components,
        "summary": summary,
    }
