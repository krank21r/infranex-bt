"""
Recovery API routes — thin wrappers over RecoveryEngine.
"""
from typing import Any, Dict
from fastapi import APIRouter, Depends, HTTPException, status, Body, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.schemas.common import APIResponse
from app.recovery.recovery import RecoveryEngine
from app.recovery.health_checker import aggregate_health_signal

router = APIRouter(prefix="/recover", tags=["recovery"])


@router.post("/decide", response_model=APIResponse[dict])
async def decide_recovery(
    db: AsyncSession = Depends(get_db),
    payload: Dict[str, Any] = Body(...),
):
    miner_id = payload.get("miner_id")
    if not miner_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Missing required field: miner_id",
        )

    from app.models import Miner
    from sqlalchemy import select

    miner_result = await db.execute(
        select(Miner).where(Miner.id == str(miner_id))
    )
    miner = miner_result.scalar_one_or_none()
    if miner is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Miner {miner_id} not found",
        )

    process_running = miner.process_id is not None and miner.process_id > 0
    subnet_connected = miner.status in ("running", "active")

    health_signal = aggregate_health_signal(
        process_running=process_running,
        subnet_connected=subnet_connected,
    )

    engine = RecoveryEngine(db=db)
    action = await engine.decide(miner_id=str(miner_id), health_signal=health_signal)
    return APIResponse(success=True, data=action.to_dict())


@router.get("/health/{miner_id}", response_model=APIResponse[dict])
async def get_miner_health(
    miner_id: str = Path(..., description="Miner ID"),
    db: AsyncSession = Depends(get_db),
):
    from app.models import Miner
    from sqlalchemy import select

    miner_result = await db.execute(
        select(Miner).where(Miner.id == miner_id)
    )
    miner = miner_result.scalar_one_or_none()
    if miner is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Miner {miner_id} not found",
        )

    process_running = miner.process_id is not None and miner.process_id > 0
    subnet_connected = miner.status in ("running", "active")

    health_signal = aggregate_health_signal(
        process_running=process_running,
        subnet_connected=subnet_connected,
    )
    return APIResponse(success=True, data=health_signal.to_dict())
