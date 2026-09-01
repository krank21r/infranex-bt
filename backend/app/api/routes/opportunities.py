"""
Opportunity scoring API routes — thin wrappers over OpportunityService.
"""

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.schemas.common import APIResponse, PaginationMeta
from app.services.opportunity_service import OpportunityService

router = APIRouter(prefix="/opportunities", tags=["opportunities"])


@router.get("", response_model=APIResponse[list[dict]])
async def list_opportunities(
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    min_score: float | None = Query(None, ge=0, le=100),
    sort_by: str = Query("score"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
):
    service = OpportunityService(db)
    rows, total = await service.list_current_opportunities(
        page=page,
        page_size=page_size,
        min_score=min_score,
        sort_by=sort_by,
        sort_order=sort_order,
    )
    items = [_serialize_score(r) for r in rows]
    total_pages = (total + page_size - 1) // page_size if total else 0
    meta = PaginationMeta(
        page=page, page_size=page_size, total_items=total,
        total_pages=total_pages, has_next=page < total_pages, has_prev=page > 1,
    )
    return APIResponse(success=True, data=items, meta=meta)


@router.get("/{netuid}", response_model=APIResponse[dict])
async def get_opportunity(
    netuid: int,
    db: AsyncSession = Depends(get_db),
):
    service = OpportunityService(db)
    score = await service.score_subnet(netuid)
    if not score:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Opportunity score for subnet {netuid} not available",
        )
    return APIResponse(success=True, data=score)


@router.get("/top/{limit}", response_model=APIResponse[list[dict]])
async def get_top_opportunities(
    limit: int = Path(ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    service = OpportunityService(db)
    rows = await service.top_n(limit=limit)
    return APIResponse(success=True, data=[_serialize_score(r) for r in rows])


@router.post("/{netuid}/recalculate", response_model=APIResponse[dict])
async def recalculate_opportunity(
    netuid: int,
    db: AsyncSession = Depends(get_db),
):
    service = OpportunityService(db)
    score = await service.score_subnet(netuid)
    if not score:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Subnet {netuid} not found or insufficient data",
        )
    persisted = await service.persist_score(netuid, score)
    return APIResponse(
        success=True,
        data=_serialize_score(persisted),
        message="Opportunity score recalculated and persisted",
    )


def _serialize_score(r) -> dict:
    return {
        "id": str(r.id) if r.id else None,
        "netuid": r.netuid,
        "total_score": r.score,
        "score": r.score,
        "model_version": r.score_model_version,
        "explanation": r.explanation,
        "calculated_at": r.created_at.isoformat() if r.created_at else None,
    }
