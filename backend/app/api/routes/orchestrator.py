"""
Miner Orchestrator API routes — thin wrappers over MinerOrchestrator.
"""
from typing import Any, Dict
from fastapi import APIRouter, Depends, HTTPException, status, Body
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.schemas.common import APIResponse
from app.orchestrator.orchestrator import MinerOrchestrator
from app.strategy.engine import Action, PortfolioState

router = APIRouter(prefix="/orchestrator", tags=["orchestrator"])


@router.post("/tick", response_model=APIResponse[dict])
async def run_orchestrator_tick(
    db: AsyncSession = Depends(get_db),
):
    orchestrator = MinerOrchestrator(db=db)
    portfolio = PortfolioState()
    summary = await orchestrator.tick(portfolio=portfolio)
    return APIResponse(success=True, data=summary)


@router.post("/process", response_model=APIResponse[dict])
async def process_action(
    db: AsyncSession = Depends(get_db),
    payload: Dict[str, Any] = Body(...),
):
    action_data = payload.get("action")
    if not action_data:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Missing required field: action",
        )

    action = Action(
        action_type=str(action_data.get("action_type", "")),
        netuid=int(action_data.get("netuid", 0)),
        score=float(action_data.get("score", 0.0)),
        reason=str(action_data.get("reason", "")),
        confidence=action_data.get("confidence"),
        estimated_monthly_profit_inr=action_data.get("estimated_monthly_profit_inr"),
        estimated_monthly_cost_inr=action_data.get("estimated_monthly_cost_inr"),
        constraints_violated=action_data.get("constraints_violated", []),
        metadata=action_data.get("metadata", {}),
    )

    orchestrator = MinerOrchestrator(db=db)
    result = await orchestrator.process_action(action)
    return APIResponse(success=True, data=result)


@router.get("/status", response_model=APIResponse[dict])
async def get_orchestrator_status(
    db: AsyncSession = Depends(get_db),
):
    orchestrator = MinerOrchestrator(db=db)
    summary = await orchestrator.tick(portfolio=PortfolioState())
    return APIResponse(success=True, data=summary)
