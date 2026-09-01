"""
Opportunity service — compute + persist subnet opportunity scores.

v2.0 uses the 3-pillar scoring model (utility, technical, economics).
Falls back to empty data when the database is not configured (mock/dev mode).
"""
import logging
from typing import Any

from sqlalchemy import asc, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.intelligence import (
    SCORE_MODEL_VERSION,
    compute_opportunity_score,
)
from app.models import (
    GPUModel,
    GPUOffer,
    MarketData,
    OpportunityScore,
    Repository,
    Subnet,
    SubnetMetrics,
    SubnetRequirement,
)
from app.models import (
    ScoreComponent as ScoreComponentORM,
)

logger = logging.getLogger(__name__)


def _to_float(value) -> float:
    try:
        return float(value) if value is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def _metrics_to_dict(m: SubnetMetrics) -> dict[str, Any]:
    return {
        "netuid": m.netuid,
        "emission": _to_float(m.emission),
        "average_incentive": _to_float(m.average_incentive),
        "total_stake": _to_float(m.total_stake),
        "top_5_concentration": _to_float(m.top_5_concentration),
        "top_10_concentration": _to_float(m.top_10_concentration),
        "miner_turnover": _to_float(m.miner_turnover),
        "neuron_utilization": _to_float(m.neuron_utilization),
        "top_incentive": _to_float(m.top_incentive),
        "median_incentive": _to_float(m.median_incentive),
        "registration_cost": _to_float(m.registration_cost),
        "miner_count": _to_float(m.miner_count),
        "trust": _to_float(m.trust),
        "consensus": _to_float(m.consensus),
        "validator_count": _to_float(m.validator_count),
    }


def _market_to_dict(m: MarketData | None) -> dict[str, Any]:
    if m is None:
        return {
            "alpha_price_1d_change": 0.0,
            "liquidity": 0.0,
            "volume_market_cap_ratio": 0.0,
            "tao_price_usd": 0.0,
        }
    return {
        "alpha_price_1d_change": _to_float(m.alpha_price_1d_change),
        "liquidity": _to_float(m.liquidity),
        "volume_market_cap_ratio": _to_float(m.volume_market_cap_ratio),
        "tao_price_usd": _to_float(m.tao_price_usd),
    }


def _requirements_to_dict(r: SubnetRequirement | None) -> dict[str, Any]:
    if r is None:
        return {}
    return {
        "python_version": r.python_version,
        "cuda_version": r.cuda_version,
        "pytorch_version": r.pytorch_version,
        "min_vram_gb": _to_float(r.min_vram_gb),
        "recommended_gpu": r.recommended_gpu,
        "ram_gb": _to_float(r.ram_gb),
        "cpu_cores": int(r.cpu_cores) if r.cpu_cores is not None else None,
        "storage_gb": _to_float(r.storage_gb),
        "docker_required": bool(r.docker_required) if r.docker_required is not None else None,
        "nvidia_runtime_required": bool(r.nvidia_runtime_required) if r.nvidia_runtime_required is not None else None,
        "ports": list(r.ports) if r.ports else [],
        "env_variables": r.env_variables or {},
        "startup_command": r.startup_command,
        "miner_command": r.miner_command,
        "dependencies": r.dependencies or {},
        "raw_requirements": r.raw_requirements or {},
        "extraction_confidence": _to_float(r.extraction_confidence),
    }


def _gpus_to_list(gpus: list[GPUModel]) -> list[dict[str, Any]]:
    return [{"vram_gb": _to_float(g.vram_gb)} for g in gpus]


def _subnet_metadata_to_dict(subnet: Subnet) -> dict[str, Any]:
    return {
        "netuid": subnet.netuid,
        "name": subnet.name,
        "description": subnet.description,
        "subnet_type": subnet.subnet_type,
        "owner_hotkey": subnet.owner_hotkey,
        "max_neurons": subnet.max_neurons,
        "max_allowed_validators": subnet.max_allowed_validators,
        "immunity_period": subnet.immunity_period,
        "tempo": subnet.tempo,
        "is_active": subnet.is_active,
        "registration_open": subnet.registration_open,
        "metadata": subnet.extra_metadata or {},
    }


async def _get_gpu_cost_hourly(db: AsyncSession) -> float:
    result = await db.execute(
        select(func.avg(GPUOffer.hourly_price)).where(GPUOffer.availability == "available")
    )
    avg_price = result.scalar_one_or_none()
    return _to_float(avg_price)


class OpportunityService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def latest_market(self) -> MarketData | None:
        result = await self.db.execute(
            select(MarketData).order_by(desc(MarketData.recorded_at)).limit(1)
        )
        return result.scalar_one_or_none()

    async def list_requirements(self) -> list[SubnetRequirement]:
        result = await self.db.execute(select(SubnetRequirement))
        return list(result.scalars().all())

    async def list_gpus(self) -> list[GPUModel]:
        result = await self.db.execute(select(GPUModel))
        return list(result.scalars().all())

    async def score_subnet(self, netuid: int) -> dict[str, Any] | None:
        subnet_q = await self.db.execute(
            select(Subnet).where(Subnet.netuid == netuid)
        )
        subnet = subnet_q.scalar_one_or_none()
        if subnet is None:
            return None

        metrics_q = await self.db.execute(
            select(SubnetMetrics)
            .where(SubnetMetrics.netuid == netuid)
            .order_by(desc(SubnetMetrics.recorded_at))
            .limit(1)
        )
        metrics = metrics_q.scalar_one_or_none()
        if metrics is None:
            return None

        req_q = await self.db.execute(
            select(SubnetRequirement).where(SubnetRequirement.netuid == netuid)
        )
        requirements = req_q.scalar_one_or_none()
        market = await self.latest_market()
        gpus = await self.list_gpus()

        repo_q = await self.db.execute(
            select(Repository).where(Repository.netuid == netuid)
        )
        repo = repo_q.scalar_one_or_none()
        readme_analysis = repo.readme_content if repo and repo.readme_content else ""

        utility_data = {
            "subnet": _subnet_metadata_to_dict(subnet),
            "readme_analysis": readme_analysis,
            "metadata": subnet.extra_metadata or {},
        }

        technical_data = {
            "requirements": _requirements_to_dict(requirements),
            "gpus": _gpus_to_list(gpus),
            "extraction_confidence": _requirements_to_dict(requirements).get("extraction_confidence", 0.0),
        }

        gpu_cost_hourly = await _get_gpu_cost_hourly(self.db)
        economics_data = {
            "metrics": _metrics_to_dict(metrics),
            "market": _market_to_dict(market),
            "gpu_cost_hourly": gpu_cost_hourly,
        }

        result = compute_opportunity_score(
            utility_data=utility_data,
            technical_data=technical_data,
            economics_data=economics_data,
        )
        result["netuid"] = netuid
        result["subnet_name"] = subnet.name
        result["pillar_scores"] = result.get("pillar_scores", {})
        result["decision"] = result.get("decision", "AVOID")
        return result

    async def persist_score(
        self, netuid: int, score: dict[str, Any]
    ) -> OpportunityScore:
        pillar_scores = score.get("pillar_scores", {})
        components = score.get("components", [])
        explanation = score.get("summary", "") or ""
        row = OpportunityScore(
            netuid=netuid,
            score=score["total_score"],
            score_model_version=score.get("model_version", SCORE_MODEL_VERSION),
            pillar_version=score.get("model_version", SCORE_MODEL_VERSION),
            utility_score=pillar_scores.get("utility"),
            technical_score=pillar_scores.get("technical"),
            economics_score=pillar_scores.get("economics"),
            decision=score.get("decision"),
            explanation=explanation or None,
            extra_metadata={
                "pillar_breakdown": pillar_scores,
                "weights": score.get("weights", {}),
                "components": components,
            },
        )
        self.db.add(row)
        await self.db.flush()

        for comp in components:
            self.db.add(
                ScoreComponentORM(
                    opportunity_score_id=row.id,
                    component_name=comp.get("name", ""),
                    score=comp.get("score", 0.0),
                    weight=comp.get("weight", 0.0),
                    explanation=comp.get("explanation", ""),
                    raw_values=comp,
                )
            )
        await self.db.commit()
        await self.db.refresh(row)
        return row

    async def get_pillar_breakdown(self, score_id: str) -> dict[str, Any] | None:
        result = await self.db.execute(
            select(OpportunityScore).where(OpportunityScore.id == score_id)
        )
        row = result.scalar_one_or_none()
        if row is None:
            return None
        return {
            "score_id": row.id,
            "netuid": row.netuid,
            "total_score": row.score,
            "pillar_version": row.pillar_version,
            "decision": row.decision,
            "pillar_scores": {
                "utility": row.utility_score,
                "technical": row.technical_score,
                "economics": row.economics_score,
            },
            "components": [
                {
                    "name": c.component_name,
                    "score": c.score,
                    "weight": c.weight,
                    "explanation": c.explanation,
                    "raw_values": c.raw_values,
                }
                for c in row.score_components
            ],
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }

    async def list_current_opportunities(
        self,
        page: int = 1,
        page_size: int = 20,
        min_score: float | None = None,
        decision: str | None = None,
        sort_by: str = "score",
        sort_order: str = "desc",
    ) -> tuple[list[OpportunityScore], int]:
        query = select(OpportunityScore)
        if min_score is not None:
            query = query.where(OpportunityScore.score >= min_score)
        if decision is not None:
            query = query.where(OpportunityScore.decision == decision)

        total = await self.db.scalar(
            select(func.count()).select_from(query.subquery())
        ) or 0

        col = getattr(OpportunityScore, sort_by, OpportunityScore.score)
        query = query.order_by(desc(col) if sort_order == "desc" else asc(col))
        query = query.offset((page - 1) * page_size).limit(page_size)
        result = await self.db.execute(query)
        return list(result.scalars().all()), total

    async def top_n(
        self,
        limit: int = 10,
        decision: str | None = None,
    ) -> list[OpportunityScore]:
        query = select(OpportunityScore)
        if decision is not None:
            query = query.where(OpportunityScore.decision == decision)
        result = await self.db.execute(
            query.order_by(desc(OpportunityScore.score)).limit(limit)
        )
        return list(result.scalars().all())

    async def get_watchlist(self) -> list[OpportunityScore]:
        result = await self.db.execute(
            select(OpportunityScore)
            .where(OpportunityScore.decision == "WATCH")
            .order_by(desc(OpportunityScore.score))
        )
        return list(result.scalars().all())
