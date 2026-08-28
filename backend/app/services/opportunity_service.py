"""
Opportunity service — compute + persist subnet opportunity scores.

Uses the explainable v1.0 rule-based scoring engine from `app.intelligence`.
Falls back to empty data when the database is not configured (mock/dev mode).
"""
import logging
from typing import Optional, List, Tuple, Dict, Any

from sqlalchemy import select, func, desc, asc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Subnet,
    SubnetMetrics,
    MarketData,
    SubnetRequirement,
    GPUModel,
    OpportunityScore,
    ScoreComponent as ScoreComponentORM,
)
from app.intelligence import (
    compute_opportunity_score,
    SCORE_MODEL_VERSION,
)

logger = logging.getLogger(__name__)


def _to_float(value) -> float:
    try:
        return float(value) if value is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def _metrics_to_dict(m: SubnetMetrics) -> Dict[str, Any]:
    return {
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


def _market_to_dict(m: Optional[MarketData]) -> Dict[str, Any]:
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


def _requirements_to_dict(r: Optional[SubnetRequirement]) -> Dict[str, Any]:
    """Map a SubnetRequirement row to the dict the score engine consumes.

    Empty dict when no row exists; full 16-field mapping when one does.
    `extraction_confidence` is included so the score path can audit
    extraction quality later (Phase 6+) without re-querying.
    """
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
    return {"min_vram_gb": _to_float(r.min_vram_gb)}


def _gpus_to_list(gpus: List[GPUModel]) -> List[Dict[str, Any]]:
    return [{"vram_gb": _to_float(g.vram_gb)} for g in gpus]


class OpportunityService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def latest_market(self) -> Optional[MarketData]:
        result = await self.db.execute(
            select(MarketData).order_by(desc(MarketData.recorded_at)).limit(1)
        )
        return result.scalar_one_or_none()

    async def list_requirements(self) -> List[SubnetRequirement]:
        result = await self.db.execute(select(SubnetRequirement))
        return list(result.scalars().all())

    async def list_gpus(self) -> List[GPUModel]:
        result = await self.db.execute(select(GPUModel))
        return list(result.scalars().all())

    async def score_subnet(self, netuid: int) -> Optional[Dict[str, Any]]:
        """Compute opportunity score for one subnet. Returns dict or None."""
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

        result = compute_opportunity_score(
            metrics=_metrics_to_dict(metrics),
            market=_market_to_dict(market),
            requirements=_requirements_to_dict(requirements),
            gpus=_gpus_to_list(gpus),
        )
        result["netuid"] = netuid
        result["subnet_name"] = subnet.name
        return result

    async def persist_score(
        self, netuid: int, score: Dict[str, Any]
    ) -> OpportunityScore:
        """Persist a computed score into the opportunity_scores + components tables."""
        components = score.get("components", [])
        primary = max(components, key=lambda c: c.get("score", 0)) if components else None
        explanation = (
            score.get("summary", "")
            if not primary
            else f"{primary.get('explanation', '')} | {score.get('summary', '')}".strip(" |")
        )
        row = OpportunityScore(
            netuid=netuid,
            score=score["total_score"],
            score_model_version=score.get("model_version", SCORE_MODEL_VERSION),
            explanation=explanation or None,
        )
        self.db.add(row)
        await self.db.flush()

        for comp in components:
            self.db.add(
                ScoreComponentORM(
                    opportunity_score_id=row.id,
                    component_name=comp["name"],
                    score=comp["score"],
                    weight=comp["weight"],
                    explanation=comp.get("explanation", ""),
                )
            )
        await self.db.commit()
        await self.db.refresh(row)
        return row

    async def list_current_opportunities(
        self,
        page: int = 1,
        page_size: int = 20,
        min_score: Optional[float] = None,
        sort_by: str = "score",
        sort_order: str = "desc",
    ) -> Tuple[List[OpportunityScore], int]:
        """List the most recent persisted score per subnet."""
        query = select(OpportunityScore)
        if min_score is not None:
            query = query.where(OpportunityScore.score >= min_score)

        total = await self.db.scalar(
            select(func.count()).select_from(query.subquery())
        ) or 0

        col = getattr(OpportunityScore, sort_by, OpportunityScore.score)
        query = query.order_by(desc(col) if sort_order == "desc" else asc(col))
        query = query.offset((page - 1) * page_size).limit(page_size)
        result = await self.db.execute(query)
        return list(result.scalars().all()), total

    async def top_n(self, limit: int = 10) -> List[OpportunityScore]:
        result = await self.db.execute(
            select(OpportunityScore)
            .order_by(desc(OpportunityScore.score))
            .limit(limit)
        )
        return list(result.scalars().all())
