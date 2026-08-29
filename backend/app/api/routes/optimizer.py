"""
Optimizer API routes — thin wrappers over Optimizer.
"""
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.schemas.common import APIResponse
from app.optimizer.optimizer import Optimizer

router = APIRouter(prefix="/optimizer", tags=["optimizer"])


@router.get("/savings", response_model=APIResponse[list[dict]])
async def get_cost_savings(
    db: AsyncSession = Depends(get_db),
    deployment_id: Optional[str] = Query(None, description="Filter by deployment ID"),
):
    optimizer = Optimizer(db=db)
    if deployment_id:
        result = await optimizer.find_cost_savings(deployment_id=deployment_id)
        if result is None:
            return APIResponse(success=True, data=[])
        return APIResponse(success=True, data=[result.to_dict()])

    from app.models import Deployment
    from sqlalchemy import select

    deployments_result = await db.execute(
        select(Deployment).where(Deployment.status == "running")
    )
    deployments = deployments_result.scalars().all()

    savings = []
    for deployment in deployments:
        result = await optimizer.find_cost_savings(deployment_id=str(deployment.id))
        if result is not None:
            savings.append(result.to_dict())

    savings.sort(key=lambda x: x.get("savings_per_month", 0.0), reverse=True)
    return APIResponse(success=True, data=savings)


@router.get("/subnet-alternatives", response_model=APIResponse[list[dict]])
async def get_subnet_alternatives(
    db: AsyncSession = Depends(get_db),
    netuid: Optional[int] = Query(None, description="Current subnet netuid"),
):
    optimizer = Optimizer(db=db)
    if netuid is None:
        from app.models import SubnetMetrics
        from sqlalchemy import select

        result = await db.execute(
            select(SubnetMetrics.netuid).where(SubnetMetrics.netuid.isnot(None)).limit(1)
        )
        row = result.scalar_one_or_none()
        if row is None:
            return APIResponse(success=True, data=[])
        netuid = row

    alternatives = await optimizer.evaluate_subnet_alternatives(netuid=int(netuid))
    return APIResponse(success=True, data=[a.to_dict() for a in alternatives])


@router.get("/config-suggestions", response_model=APIResponse[list[dict]])
async def get_config_suggestions(
    db: AsyncSession = Depends(get_db),
    miner_id: Optional[str] = Query(None, description="Miner ID"),
):
    optimizer = Optimizer(db=db)
    if not miner_id:
        from app.models import Miner
        from sqlalchemy import select

        result = await db.execute(select(Miner.id).limit(1))
        row = result.scalar_one_or_none()
        if row is None:
            return APIResponse(success=True, data=[])
        miner_id = row

    suggestions = await optimizer.suggest_config_tweaks(miner_id=str(miner_id))
    return APIResponse(success=True, data=[s.to_dict() for s in suggestions])
