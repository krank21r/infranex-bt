"""
Subnet API routes — thin wrappers over SubnetService.
"""
from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_subnet_service
from app.schemas.common import APIResponse, PaginationMeta
from app.services.subnet_service import SubnetService

router = APIRouter(prefix="/subnets", tags=["subnets"])


@router.get("", response_model=APIResponse[list[dict]])
async def list_subnets(
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort_by: str = Query("netuid"),
    sort_order: str = Query("asc", pattern="^(asc|desc)$"),
    is_active: Optional[bool] = Query(None),
    search: Optional[str] = Query(None, description="Search name/description"),
    subnet_service: SubnetService = Depends(get_subnet_service),
) -> APIResponse[list[dict]]:
    subnets, total = await subnet_service.list_subnets(
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        sort_order=sort_order,
        is_active=is_active,
        search=search,
    )
    items = [_serialize_subnet(s) for s in subnets]
    total_pages = (total + page_size - 1) // page_size if total else 0
    meta = PaginationMeta(
        page=page, page_size=page_size, total_items=total,
        total_pages=total_pages, has_next=page < total_pages, has_prev=page > 1,
    )
    return APIResponse(success=True, data=items, meta=meta)


@router.get("/{netuid}", response_model=APIResponse[dict])
async def get_subnet(
    netuid: int,
    db: AsyncSession = Depends(get_db),
    subnet_service: SubnetService = Depends(get_subnet_service),
) -> APIResponse[dict]:
    subnet = await subnet_service.get_subnet(netuid)
    if not subnet:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Subnet {netuid} not found",
        )
    metrics = await subnet_service.latest_metrics(netuid)
    payload = _serialize_subnet(subnet)
    payload["latest_metrics"] = _serialize_metrics(metrics) if metrics else None
    return APIResponse(success=True, data=payload)


@router.get("/{netuid}/metrics", response_model=APIResponse[dict])
async def get_subnet_metrics(
    netuid: int,
    db: AsyncSession = Depends(get_db),
    subnet_service: SubnetService = Depends(get_subnet_service),
) -> APIResponse[dict]:
    metrics = await subnet_service.latest_metrics(netuid)
    if not metrics:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Metrics for subnet {netuid} not found",
        )
    return APIResponse(success=True, data=_serialize_metrics(metrics))


@router.get("/{netuid}/opportunity", response_model=APIResponse[dict])
async def get_subnet_opportunity(
    netuid: int,
    db: AsyncSession = Depends(get_db),
):
    from app.services.opportunity_service import OpportunityService
    opportunity_service = OpportunityService(db)
    score = await opportunity_service.score_subnet(netuid)
    if not score:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Opportunity score for subnet {netuid} not available",
        )
    return APIResponse(success=True, data=score)


def _serialize_subnet(s) -> dict:
    return {
        "id": str(s.id) if s.id else None,
        "netuid": s.netuid,
        "name": s.name,
        "description": s.description,
        "subnet_type": s.subnet_type,
        "owner_hotkey": s.owner_hotkey,
        "max_neurons": s.max_neurons,
        "tempo": s.tempo,
        "difficulty": s.difficulty,
        "is_active": s.is_active,
        "registration_open": s.registration_open,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


def _serialize_metrics(m) -> dict:
    return {
        "netuid": m.netuid,
        "block": m.block,
        "emission": float(m.emission) if m.emission is not None else None,
        "average_incentive": float(m.average_incentive) if m.average_incentive is not None else None,
        "total_stake": float(m.total_stake) if m.total_stake is not None else None,
        "top_5_concentration": float(m.top_5_concentration) if m.top_5_concentration is not None else None,
        "miner_count": m.miner_count,
        "validator_count": m.validator_count,
        "trust": float(m.trust) if m.trust is not None else None,
        "consensus": float(m.consensus) if m.consensus is not None else None,
        "recorded_at": m.recorded_at.isoformat() if m.recorded_at else None,
    }
