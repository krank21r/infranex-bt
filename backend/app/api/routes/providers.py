"""
GPU Provider API routes — thin wrappers over GPUService.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_gpu_service
from app.schemas.common import APIResponse, PaginationMeta
from app.services.gpu_service import GPUService

router = APIRouter(prefix="/providers", tags=["providers"])


@router.get("", response_model=APIResponse[list[dict]])
async def list_providers(
    db: AsyncSession = Depends(get_db),
    is_active: bool | None = Query(True),
    gpu_service: GPUService = Depends(get_gpu_service),
) -> APIResponse[list[dict]]:
    providers = await gpu_service.list_providers(is_active=is_active)
    return APIResponse(success=True, data=[_serialize(p) for p in providers])


@router.get("/{provider_id}", response_model=APIResponse[dict])
async def get_provider(
    provider_id: str,
    db: AsyncSession = Depends(get_db),
    gpu_service: GPUService = Depends(get_gpu_service),
) -> APIResponse[dict]:
    provider = await gpu_service.get_provider(provider_id)
    if not provider:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"GPU provider {provider_id} not found",
        )
    return APIResponse(success=True, data=_serialize(provider))


@router.get("/{provider_id}/offers", response_model=APIResponse[list[dict]])
async def get_provider_offers(
    provider_id: str,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    region: str | None = Query(None),
    is_spot: bool | None = Query(None),
    sort_by: str = Query("hourly_price"),
    sort_order: str = Query("asc", pattern="^(asc|desc)$"),
    gpu_service: GPUService = Depends(get_gpu_service),
) -> APIResponse[list[dict]]:
    offers, total = await gpu_service.list_offers(
        page=page, page_size=page_size,
        provider_id=provider_id,
        region=region,
        is_spot=is_spot,
        sort_by=sort_by, sort_order=sort_order,
    )
    items = [_serialize_offer(o) for o in offers]
    total_pages = (total + page_size - 1) // page_size if total else 0
    meta = PaginationMeta(
        page=page, page_size=page_size, total_items=total,
        total_pages=total_pages, has_next=page < total_pages, has_prev=page > 1,
    )
    return APIResponse(success=True, data=items, meta=meta)


def _serialize(p) -> dict:
    return {
        "id": str(p.id) if p.id else None,
        "name": p.name,
        "slug": p.slug,
        "is_active": p.is_active,
        "supports_mock": p.supports_mock,
    }


def _serialize_offer(o) -> dict:
    return {
        "id": str(o.id) if o.id else None,
        "provider_id": str(o.provider_id) if o.provider_id else None,
        "gpu_model_id": str(o.gpu_model_id) if o.gpu_model_id else None,
        "instance_type": o.instance_type,
        "region": o.region,
        "hourly_price": float(o.hourly_price) if o.hourly_price is not None else None,
        "monthly_price": float(o.monthly_price) if o.monthly_price is not None else None,
        "currency": o.currency,
        "availability": o.availability,
        "vram_gb": o.vram_gb,
        "is_spot": o.is_spot,
    }
