"""
Learning Engine API routes — thin wrappers over FeedbackLoop and AccuracyTracker.
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.schemas.common import APIResponse
from app.learning.feedback import FeedbackLoop
from app.learning.tracker import AccuracyTracker

router = APIRouter(prefix="/learning", tags=["learning"])


@router.get("/status", response_model=APIResponse[dict])
async def get_learning_status(
    db: AsyncSession = Depends(get_db),
):
    from app.models import AccuracyTracking as AccuracyTrackingORM, WeightAdjustment as WeightAdjustmentORM
    from sqlalchemy import select, func

    accuracy_count = (
        await db.execute(select(func.count()).select_from(AccuracyTrackingORM))
    ).scalar_one()

    weight_count = (
        await db.execute(select(func.count()).select_from(WeightAdjustmentORM))
    ).scalar_one()

    return APIResponse(
        success=True,
        data={
            "engine_version": "v1.0",
            "total_accuracy_records": accuracy_count,
            "total_weight_adjustments": weight_count,
            "status": "active",
        },
    )


@router.post("/feedback", response_model=APIResponse[dict])
async def trigger_feedback_loop(
    db: AsyncSession = Depends(get_db),
):
    feedback = FeedbackLoop(db=db)
    summary = await feedback.run_learning_cycle()
    return APIResponse(success=True, data=summary)


@router.get("/accuracy", response_model=APIResponse[dict])
async def get_accuracy_metrics(
    db: AsyncSession = Depends(get_db),
    model_version: str = Query("v1.0", description="Model version to evaluate"),
):
    tracker = AccuracyTracker(db=db)
    try:
        metrics = await tracker.compute_model_accuracy(model_version=model_version)
        return APIResponse(success=True, data=metrics.to_dict())
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        )
