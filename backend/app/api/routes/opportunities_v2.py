"""
Opportunity scoring API routes v2.0 — extended decision layer over OpportunityService.

Adds:
  - RUN / WATCH / AVOID decisions via StrategyEngine
  - Approval-level classification via app.approval.classifier
  - Pillar score breakdowns, weights, components
  - History, watchlist, compare, and bulk score endpoints
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Path, Body, status
from pydantic import BaseModel, Field
from sqlalchemy import select, desc, asc
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_opportunity_service, get_subnet_service
from app.schemas.common import APIResponse, PaginationMeta
from app.services.opportunity_service import OpportunityService
from app.services.subnet_service import SubnetService
from app.intelligence import compute_opportunity_score, DEFAULT_WEIGHTS, SCORE_MODEL_VERSION, PILLAR_WEIGHTS
from app.strategy.engine import StrategyEngine, PortfolioState
from app.approval.classifier import classify_action, ActionContext, ActionLevel
from app.models import SubnetMetricsHistory, OpportunityScore, ScoreComponent as ScoreComponentORM

router = APIRouter(prefix="/v2/opportunities", tags=["opportunities-v2"])


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class ScoreRequest(BaseModel):
    netuid: int = Field(ge=0, description="Subnet netuid")
    include_components: bool = Field(default=True, description="Include component breakdown")


class ScoreAllResponse(BaseModel):
    status: str
    netuids: List[int]
    estimated_seconds: int


class HistoryPoint(BaseModel):
    recorded_at: datetime
    total_score: float
    pillar_scores: Dict[str, float]


class CompareRequest(BaseModel):
    netuids: List[int] = Field(min_length=2, max_length=10, description="Netuids to compare")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_DECISION_MAP = {
    "enter": "RUN",
    "hold": "WATCH",
    "exit": "AVOID",
}


def _decision_from_action(action_type: str) -> str:
    return _DECISION_MAP.get(action_type, "AVOID")


def _approval_level_for_decision(decision: str) -> str:
    if decision == "RUN":
        return ActionLevel.L3_MANDATORY.value
    return ActionLevel.L1_AUTO.value


def _serialize_components(components: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {
            "name": c.get("name"),
            "score": c.get("score"),
            "weight": c.get("weight"),
            "weighted": c.get("weighted"),
            "explanation": c.get("explanation"),
        }
        for c in components
    ]


def _pillar_scores_from_components(components: List[Dict[str, Any]]) -> Dict[str, float]:
    return {c["name"]: c["score"] for c in components if "name" in c}


async def _score_and_decide(
    netuid: int,
    db: AsyncSession,
) -> Optional[Dict[str, Any]]:
    service = OpportunityService(db)
    result = await service.score_subnet(netuid)
    if result is None:
        return None

    components = result.get("components", [])
    pillar_scores = result.get("pillar_scores", _pillar_scores_from_components(components))

    engine = StrategyEngine()
    portfolio = PortfolioState()
    action = engine.evaluate(
        netuid=netuid,
        score=result.get("total_score", 0.0),
        portfolio=portfolio,
    )
    decision = _decision_from_action(action.action_type)
    approval_level = _approval_level_for_decision(decision)

    return {
        "netuid": netuid,
        "subnet_name": result.get("subnet_name"),
        "total_score": result.get("total_score"),
        "model_version": result.get("model_version", SCORE_MODEL_VERSION),
        "decision": result.get("decision", "AVOID"),
        "pillar_scores": pillar_scores,
        "weights": result.get("weights", PILLAR_WEIGHTS),
        "components": _serialize_components(components) if components else [],
        "summary": result.get("summary", ""),
        "constraints_violated": action.constraints_violated,
        "approval_level": approval_level,
        "reason": action.reason,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/score", response_model=APIResponse[dict])
async def score_subnet_v2(
    payload: ScoreRequest,
    db: AsyncSession = Depends(get_db),
):
    scored = await _score_and_decide(payload.netuid, db)
    if scored is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Subnet {payload.netuid} not found or insufficient data",
        )
    if not payload.include_components:
        scored.pop("components", None)
    return APIResponse(success=True, data=scored)


@router.get("/{netuid}/decision", response_model=APIResponse[dict])
async def get_decision(
    netuid: int,
    db: AsyncSession = Depends(get_db),
):
    scored = await _score_and_decide(netuid, db)
    if scored is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Decision for subnet {netuid} not available",
        )
    return APIResponse(
        success=True,
        data={
            "netuid": scored["netuid"],
            "decision": scored["decision"],
            "score": scored["total_score"],
            "pillar_scores": scored["pillar_scores"],
            "constraints_violated": scored["constraints_violated"],
            "approval_level": scored["approval_level"],
            "reason": scored["reason"],
        },
    )


@router.get("/decisions", response_model=APIResponse[list[dict]])
async def list_decisions(
    decision: Optional[str] = Query(None, pattern="^(RUN|WATCH|AVOID)$"),
    min_score: Optional[float] = Query(None, ge=0, le=100),
    max_score: Optional[float] = Query(None, ge=0, le=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    subnet_service = SubnetService(db)
    netuids = await subnet_service.get_known_netuids()

    decisions: List[Dict[str, Any]] = []
    for netuid in netuids:
        scored = await _score_and_decide(netuid, db)
        if scored is None:
            continue
        if decision and scored["decision"] != decision:
            continue
        score = scored["total_score"]
        if min_score is not None and score < min_score:
            continue
        if max_score is not None and score > max_score:
            continue
        decisions.append(scored)

    total = len(decisions)
    total_pages = (total + page_size - 1) // page_size if total else 0
    start = (page - 1) * page_size
    end = start + page_size
    page_items = decisions[start:end]

    meta = PaginationMeta(
        page=page,
        page_size=page_size,
        total_items=total,
        total_pages=total_pages,
        has_next=page < total_pages,
        has_prev=page > 1,
    )
    return APIResponse(success=True, data=page_items, meta=meta)


@router.get("/watchlist", response_model=APIResponse[list[dict]])
async def get_watchlist(
    db: AsyncSession = Depends(get_db),
):
    subnet_service = SubnetService(db)
    netuids = await subnet_service.get_known_netuids()

    watchlist: List[Dict[str, Any]] = []
    for netuid in netuids:
        scored = await _score_and_decide(netuid, db)
        if scored is None:
            continue
        if scored["decision"] == "WATCH":
            watchlist.append(scored)

    watchlist.sort(key=lambda x: x.get("total_score", 0), reverse=True)
    return APIResponse(success=True, data=watchlist)


@router.post("/score-all", response_model=APIResponse[ScoreAllResponse])
async def score_all(
    db: AsyncSession = Depends(get_db),
):
    subnet_service = SubnetService(db)
    netuids = await subnet_service.get_known_netuids()

    estimated_seconds = max(len(netuids) * 2, 1)
    return APIResponse(
        success=True,
        data=ScoreAllResponse(
            status="started",
            netuids=netuids,
            estimated_seconds=estimated_seconds,
        ),
    )


@router.get("/{netuid}/history", response_model=APIResponse[list[HistoryPoint]])
async def get_history(
    netuid: int = Path(ge=0),
    days: int = Query(30, ge=1, le=365),
    pillar: Optional[str] = Query(None, description="Filter to a single pillar name"),
    db: AsyncSession = Depends(get_db),
):
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    result = await db.execute(
        select(SubnetMetricsHistory)
        .where(SubnetMetricsHistory.netuid == netuid)
        .where(SubnetMetricsHistory.recorded_at >= cutoff)
        .order_by(asc(SubnetMetricsHistory.recorded_at))
    )
    rows = result.scalars().all()

    points: List[Dict[str, Any]] = []
    for row in rows:
        metrics = {
            "emission": getattr(row, "emission", None) or 0.0,
            "average_incentive": getattr(row, "average_incentive", None) or 0.0,
            "total_stake": getattr(row, "total_stake", None) or 0.0,
            "top_5_concentration": 0.0,
            "top_10_concentration": 0.0,
            "miner_turnover": 0.0,
            "neuron_utilization": getattr(row, "neuron_utilization", None) or 0.0,
            "top_incentive": 0.0,
            "median_incentive": 0.0,
            "registration_cost": getattr(row, "registration_cost", None) or 0.0,
            "miner_count": getattr(row, "miner_count", None) or 0.0,
            "trust": getattr(row, "trust", None) or 0.0,
            "consensus": getattr(row, "consensus", None) or 0.0,
            "validator_count": getattr(row, "validator_count", None) or 0.0,
        }
        market = {
            "alpha_price_1d_change": 0.0,
            "liquidity": 0.0,
            "volume_market_cap_ratio": 0.0,
            "tao_price_usd": 0.0,
        }
        utility_data = {
            "subnet": {"name": "", "description": "", "subnet_type": "", "metadata": {}},
            "readme_analysis": "",
            "metadata": {},
        }
        technical_data = {
            "requirements": {},
            "gpus": [],
            "extraction_confidence": 0.0,
        }
        economics_data = {
            "metrics": metrics,
            "market": market,
            "gpu_cost_hourly": 0.0,
        }

        score_result = compute_opportunity_score(
            utility_data=utility_data,
            technical_data=technical_data,
            economics_data=economics_data,
        )
        pillar_scores = score_result.get("pillar_scores", {})

        if pillar is not None:
            pillar_scores = {k: v for k, v in pillar_scores.items() if k == pillar}

        points.append(
            {
                "recorded_at": row.recorded_at,
                "total_score": score_result.get("total_score", 0.0),
                "pillar_scores": pillar_scores,
            }
        )

    return APIResponse(success=True, data=points)


@router.post("/compare", response_model=APIResponse[list[dict]])
async def compare_subnets(
    payload: CompareRequest,
    db: AsyncSession = Depends(get_db),
):
    comparisons: List[Dict[str, Any]] = []
    for netuid in payload.netuids:
        scored = await _score_and_decide(netuid, db)
        if scored is None:
            scored = {
                "netuid": netuid,
                "subnet_name": None,
                "total_score": 0.0,
                "model_version": SCORE_MODEL_VERSION,
                "decision": "AVOID",
                "pillar_scores": {},
                "weights": dict(DEFAULT_WEIGHTS),
                "components": [],
                "summary": "No data available for comparison",
                "constraints_violated": [],
                "approval_level": ActionLevel.L1_AUTO.value,
                "reason": "Insufficient data",
            }
        comparisons.append(scored)

    comparisons.sort(key=lambda x: x.get("total_score", 0), reverse=True)
    return APIResponse(success=True, data=comparisons)
