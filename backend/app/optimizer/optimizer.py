"""
Optimizer engine.

Pure-Python, deterministic analysis that feeds back to the Strategy Engine:

  1. find_cost_savings    — scan GPU catalog for cheaper offers that still
                            meet the same subnet requirements.
  2. evaluate_subnet_alternatives — score other subnets against the current
                            one to spot migration opportunities.
  3. suggest_config_tweaks — surface low-risk config improvements for a
                            running miner.

The pure functions are the authoritative computation and the test surface.
The Optimizer class is a thin DB-reading orchestrator (no writes).
"""
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Deployment,
    GPUModel,
    GPUOffer,
    Miner,
    Subnet,
    SubnetMetrics,
)
from app.intelligence import compute_opportunity_score

OPTIMIZER_MODEL_VERSION = "v1.0"


# ---------- dataclasses ----------


@dataclass(frozen=True)
class CheaperOffer:
    """A GPU offer that is cheaper than the current deployment's offer."""
    deployment_id: str
    current_hourly_price: float
    new_hourly_price: float
    savings_per_hour: float
    savings_per_month: float
    offer: Dict[str, Any]
    confidence: float
    explanation: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "deployment_id": self.deployment_id,
            "current_hourly_price": round(self.current_hourly_price, 4),
            "new_hourly_price": round(self.new_hourly_price, 4),
            "savings_per_hour": round(self.savings_per_hour, 4),
            "savings_per_month": round(self.savings_per_month, 2),
            "offer": self.offer,
            "confidence": round(self.confidence, 2),
            "explanation": self.explanation,
            "model_version": OPTIMIZER_MODEL_VERSION,
        }


@dataclass(frozen=True)
class SubnetAlternative:
    """One alternative subnet evaluated against the current one."""
    netuid: int
    name: str
    current_score: float
    alternative_score: float
    score_delta: float
    estimated_revenue_usd: float
    estimated_cost_usd: float
    registration_cost: float
    is_open: bool
    recommendation: str  # "better" | "similar" | "worse"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "netuid": self.netuid,
            "name": self.name,
            "current_score": round(self.current_score, 2),
            "alternative_score": round(self.alternative_score, 2),
            "score_delta": round(self.score_delta, 2),
            "estimated_revenue_usd": round(self.estimated_revenue_usd, 2),
            "estimated_cost_usd": round(self.estimated_cost_usd, 2),
            "registration_cost": round(self.registration_cost, 2),
            "is_open": self.is_open,
            "recommendation": self.recommendation,
            "model_version": OPTIMIZER_MODEL_VERSION,
        }


@dataclass(frozen=True)
class ConfigSuggestion:
    """One config tweak suggestion for a miner."""
    key: str
    current_value: Any
    suggested_value: Any
    reason: str
    impact: str  # "low" | "medium" | "high"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "key": self.key,
            "current_value": self.current_value,
            "suggested_value": self.suggested_value,
            "reason": self.reason,
            "impact": self.impact,
            "model_version": OPTIMIZER_MODEL_VERSION,
        }


# ---------- pure helpers ----------


def _to_float(value) -> float:
    """Safe float coercion; None / non-numeric -> 0.0."""
    try:
        return float(value) if value is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def _clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, value))


def _score_cost_savings_pure(
    current_hourly: float,
    candidate_hourly: float,
    candidate_offer: Dict[str, Any],
    requirements: Dict[str, Any],
) -> Optional[CheaperOffer]:
    """Pure: compute savings from switching to a cheaper offer.

    Returns None if candidate is not cheaper.
    """
    if candidate_hourly >= current_hourly:
        return None

    savings_per_hour = current_hourly - candidate_hourly
    savings_per_month = savings_per_hour * 730

    explanation = (
        f"Switching from ${current_hourly:.2f}/hr to ${candidate_hourly:.2f}/hr "
        f"saves ${savings_per_hour:.2f}/hr (${savings_per_month:.2f}/month). "
        f"Offer {candidate_offer.get('id', 'unknown')} on "
        f"{candidate_offer.get('gpu_model_name', 'unknown')} "
        f"in {candidate_offer.get('region', 'unknown')}."
    )

    return CheaperOffer(
        deployment_id="",
        current_hourly_price=current_hourly,
        new_hourly_price=candidate_hourly,
        savings_per_hour=savings_per_hour,
        savings_per_month=savings_per_month,
        offer=candidate_offer,
        confidence=1.0,
        explanation=explanation,
    )


def _evaluate_subnet_alternative_pure(
    current_score: float,
    utility_data: Dict[str, Any],
    technical_data: Dict[str, Any],
    economics_data: Dict[str, Any],
) -> SubnetAlternative:
    """Pure: score one alternative subnet against the current one."""
    opp = compute_opportunity_score(
        utility_data=utility_data,
        technical_data=technical_data,
        economics_data=economics_data,
    )
    alt_score = opp["total_score"]
    delta = alt_score - current_score

    if delta > 10:
        recommendation = "better"
    elif delta > -10:
        recommendation = "similar"
    else:
        recommendation = "worse"

    return SubnetAlternative(
        netuid=economics_data.get("metrics", {}).get("netuid", 0),
        name=utility_data.get("subnet", {}).get("name", ""),
        current_score=current_score,
        alternative_score=alt_score,
        score_delta=delta,
        estimated_revenue_usd=0.0,
        estimated_cost_usd=0.0,
        registration_cost=_to_float(economics_data.get("metrics", {}).get("registration_cost")),
        is_open=bool(utility_data.get("subnet", {}).get("registration_open", False)),
        recommendation=recommendation,
    )


def _suggest_config_tweaks_pure(
    deployment_config: Dict[str, Any],
    miner_metadata: Dict[str, Any],
) -> List[ConfigSuggestion]:
    """Pure: analyze config + miner metadata and return tweak suggestions."""
    suggestions: List[ConfigSuggestion] = []

    offer = deployment_config.get("offer", {})

    if offer.get("is_spot"):
        suggestions.append(
            ConfigSuggestion(
                key="is_spot",
                current_value=True,
                suggested_value=False,
                reason="Spot instances can be interrupted; consider on-demand for production miners.",
                impact="high",
            )
        )

    vram = _to_float(offer.get("vram_gb"))
    if vram > 0 and vram < 40:
        suggestions.append(
            ConfigSuggestion(
                key="vram_gb",
                current_value=vram,
                suggested_value=">= 40",
                reason="Subnets increasingly require 40+ GB VRAM for competitive performance.",
                impact="high",
            )
        )

    reqs = deployment_config.get("requirements", {})
    if not reqs.get("startup_command"):
        suggestions.append(
            ConfigSuggestion(
                key="startup_command",
                current_value=None,
                suggested_value="<validated command>",
                reason="No startup_command recorded; miner may fail to start after redeploy.",
                impact="medium",
            )
        )

    ports = reqs.get("ports") or []
    if not ports:
        suggestions.append(
            ConfigSuggestion(
                key="ports",
                current_value=[],
                suggested_value="[<required ports>]",
                reason="No ports specified; subnet communication may fail.",
                impact="medium",
            )
        )

    if not reqs.get("docker_required") and not reqs.get("nvidia_runtime_required"):
        suggestions.append(
            ConfigSuggestion(
                key="docker_required",
                current_value=False,
                suggested_value=True,
                reason="Container runtime not configured; may cause environment drift.",
                impact="low",
            )
        )

    return suggestions


# ---------- Optimizer service class ----------


class Optimizer:
    """DB-reading orchestrator for optimization suggestions.

    No DB writes. All suggestions are in-memory only; the caller
    (Strategy Engine or API) decides whether to persist or execute them.
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def find_cost_savings(self, deployment_id: str) -> Optional[CheaperOffer]:
        """Scan the GPU catalog for a cheaper offer that still meets requirements.

        Returns the best cheaper offer, or None if no cheaper option exists.
        """
        deployment = (
            (await self.db.execute(select(Deployment).where(Deployment.id == deployment_id)))
            .scalar_one_or_none()
        )
        if deployment is None:
            return None

        config = deployment.deployment_config or {}
        requirements = config.get("requirements", {})
        offer_snapshot = config.get("offer", {})

        current_hourly = _to_float(offer_snapshot.get("hourly_price"))
        if current_hourly <= 0:
            return None

        min_vram = _to_float(requirements.get("min_vram_gb"))

        stmt = (
            select(GPUOffer, GPUModel.name.label("gpu_model_name"))
            .join(GPUModel, GPUOffer.gpu_model_id == GPUModel.id)
            .where(GPUOffer.availability == "available")
            .where(GPUOffer.hourly_price < current_hourly)
        )
        if min_vram > 0:
            stmt = stmt.where(GPUOffer.vram_gb >= min_vram)

        rows = (await self.db.execute(stmt)).all()

        best: Optional[CheaperOffer] = None
        for offer, gpu_name in rows:
            candidate = {
                "id": offer.id,
                "provider_id": offer.provider_id,
                "gpu_model_id": offer.gpu_model_id,
                "gpu_model_name": gpu_name,
                "region": offer.region,
                "hourly_price": offer.hourly_price,
                "monthly_price": offer.monthly_price,
                "currency": offer.currency,
                "availability": offer.availability,
                "vram_gb": offer.vram_gb,
                "ram_gb": offer.ram_gb,
                "storage_gb": offer.storage_gb,
                "is_spot": offer.is_spot,
                "instance_type": offer.instance_type,
            }
            result = _score_cost_savings_pure(
                current_hourly,
                _to_float(offer.hourly_price),
                candidate,
                requirements,
            )
            if result is None:
                continue
            candidate_offer = CheaperOffer(
                deployment_id=deployment_id,
                current_hourly_price=current_hourly,
                new_hourly_price=_to_float(offer.hourly_price),
                savings_per_hour=current_hourly - _to_float(offer.hourly_price),
                savings_per_month=(current_hourly - _to_float(offer.hourly_price)) * 730,
                offer=candidate,
                confidence=1.0,
                explanation=result.explanation,
            )
            if best is None or candidate_offer.savings_per_month > best.savings_per_month:
                best = candidate_offer

        return best

    async def evaluate_subnet_alternatives(self, netuid: int) -> List[SubnetAlternative]:
        """Score other active subnets as migration alternatives."""
        current = (
            (await self.db.execute(select(SubnetMetrics).where(SubnetMetrics.netuid == netuid)))
            .scalar_one_or_none()
        )
        if current is None:
            return []

        current_metrics = {
            "netuid": current.netuid,
            "emission": current.emission,
            "average_incentive": current.average_incentive,
            "total_stake": current.total_stake,
            "top_5_concentration": current.top_5_concentration,
            "top_10_concentration": current.top_10_concentration,
            "miner_turnover": current.miner_turnover,
            "neuron_utilization": current.neuron_utilization,
            "top_incentive": current.top_incentive,
            "median_incentive": current.median_incentive,
            "trust": current.trust,
            "consensus": current.consensus,
            "validator_count": current.validator_count,
            "registration_cost": current.registration_cost,
            "miner_count": current.miner_count,
        }

        current_utility = {
            "subnet": {
                "name": "",
                "description": "",
                "subnet_type": "",
                "metadata": {},
            },
            "readme_analysis": "",
            "metadata": {},
        }
        current_technical = {
            "requirements": {},
            "gpus": [],
            "extraction_confidence": 0.0,
        }
        current_economics = {
            "metrics": current_metrics,
            "market": {},
            "gpu_cost_hourly": 0.0,
        }

        opp = compute_opportunity_score(
            utility_data=current_utility,
            technical_data=current_technical,
            economics_data=current_economics,
        )
        current_score = opp["total_score"]

        alternatives: List[SubnetAlternative] = []

        other_rows = (
            (await self.db.execute(
                select(SubnetMetrics, Subnet)
                .outerjoin(Subnet, SubnetMetrics.netuid == Subnet.netuid)
                .where(SubnetMetrics.netuid != netuid)
                .where(SubnetMetrics.netuid.isnot(None))
                .limit(20)
            ))
            .all()
        )

        for sm, subnet in other_rows:
            metrics = {
                "netuid": sm.netuid,
                "emission": sm.emission,
                "average_incentive": sm.average_incentive,
                "total_stake": sm.total_stake,
                "top_5_concentration": sm.top_5_concentration,
                "top_10_concentration": sm.top_10_concentration,
                "miner_turnover": sm.miner_turnover,
                "neuron_utilization": sm.neuron_utilization,
                "top_incentive": sm.top_incentive,
                "median_incentive": sm.median_incentive,
                "trust": sm.trust,
                "consensus": sm.consensus,
                "validator_count": sm.validator_count,
                "registration_cost": sm.registration_cost,
                "miner_count": sm.miner_count,
                "name": subnet.name if subnet else "",
                "registration_open": subnet.registration_open if subnet else False,
            }
            alt = _evaluate_subnet_alternative_pure(
                current_score=current_score,
                utility_data={
                    "subnet": {
                        "name": subnet.name if subnet else "",
                        "description": subnet.description if subnet else "",
                        "subnet_type": subnet.subnet_type if subnet else "",
                        "metadata": subnet.extra_metadata if subnet else {},
                    },
                    "readme_analysis": "",
                    "metadata": {},
                },
                technical_data={
                    "requirements": {},
                    "gpus": [],
                    "extraction_confidence": 0.0,
                },
                economics_data={
                    "metrics": metrics,
                    "market": {},
                    "gpu_cost_hourly": 0.0,
                },
            )
            alternatives.append(alt)

        alternatives.sort(key=lambda a: -a.score_delta)
        return alternatives[:10]

    async def suggest_config_tweaks(self, miner_id: str) -> List[ConfigSuggestion]:
        """Return config tweak suggestions for a miner."""
        miner = (
            (await self.db.execute(select(Miner).where(Miner.id == miner_id)))
            .scalar_one_or_none()
        )
        if miner is None:
            return []

        deployment = None
        if miner.deployment_id:
            deployment = (
                (await self.db.execute(select(Deployment).where(Deployment.id == miner.deployment_id)))
                .scalar_one_or_none()
            )

        config = deployment.deployment_config if deployment else {}
        metadata = miner.extra_metadata or {}

        return _suggest_config_tweaks_pure(config, metadata)
