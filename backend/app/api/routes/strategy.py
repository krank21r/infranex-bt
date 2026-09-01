"""
Strategy Engine API routes — thin wrappers over StrategyEngine.
"""
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.schemas.common import APIResponse
from app.strategy.engine import PortfolioState, StrategyEngine

router = APIRouter(prefix="/strategy", tags=["strategy"])


@router.post("/evaluate", response_model=APIResponse[dict])
async def evaluate_opportunity(
    payload: dict[str, Any] = Body(...),
):
    netuid = payload.get("netuid")
    score = payload.get("score")
    portfolio_state = payload.get("portfolio_state", {})

    if netuid is None or score is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Missing required fields: netuid, score",
        )

    portfolio = PortfolioState(
        current_miners=portfolio_state.get("current_miners", []),
        pending_deployments=portfolio_state.get("pending_deployments", []),
        monthly_spend_inr=float(portfolio_state.get("monthly_spend_inr", 0.0)),
        last_entry_timestamp=portfolio_state.get("last_entry_timestamp"),
    )

    engine = StrategyEngine()
    action = engine.evaluate(
        netuid=int(netuid),
        score=float(score),
        portfolio=portfolio,
    )
    return APIResponse(success=True, data=action.to_dict())


@router.post("/evaluate-batch", response_model=APIResponse[list[dict]])
async def evaluate_batch(
    payload: dict[str, Any] = Body(...),
):
    opportunities = payload.get("opportunities", [])
    portfolio_state = payload.get("portfolio_state", {})

    if not opportunities:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Missing required field: opportunities (non-empty list)",
        )

    portfolio = PortfolioState(
        current_miners=portfolio_state.get("current_miners", []),
        pending_deployments=portfolio_state.get("pending_deployments", []),
        monthly_spend_inr=float(portfolio_state.get("monthly_spend_inr", 0.0)),
        last_entry_timestamp=portfolio_state.get("last_entry_timestamp"),
    )

    engine = StrategyEngine()
    actions = engine.evaluate_batch(opportunities, portfolio)
    return APIResponse(success=True, data=[a.to_dict() for a in actions])


@router.get("/portfolio", response_model=APIResponse[dict])
async def get_portfolio(
    db: AsyncSession = Depends(get_db),
):
    from app.models import Deployment, Miner

    miners_result = await db.execute(
        __import__("sqlalchemy").select(Miner).where(Miner.status == "running")
    )
    running_miners = miners_result.scalars().all()

    pending_result = await db.execute(
        __import__("sqlalchemy").select(Deployment).where(Deployment.status.in_(["pending", "provisioning"]))
    )
    pending_deployments = pending_result.scalars().all()

    monthly_spend = sum(float(d.estimated_monthly_cost or 0.0) for d in pending_deployments)
    monthly_spend += sum(float(d.estimated_monthly_cost or 0.0) for d in running_miners if d.estimated_monthly_cost)

    portfolio = {
        "current_miners": [
            {
                "id": m.id,
                "netuid": m.netuid,
                "status": m.status,
                "deployment_id": m.deployment_id,
            }
            for m in running_miners
        ],
        "pending_deployments": [
            {
                "id": d.id,
                "netuid": d.netuid,
                "status": d.status,
                "estimated_monthly_cost": float(d.estimated_monthly_cost or 0.0),
            }
            for d in pending_deployments
        ],
        "monthly_spend_inr": monthly_spend,
        "active_count": len(running_miners),
        "pending_count": len(pending_deployments),
    }
    return APIResponse(success=True, data=portfolio)
