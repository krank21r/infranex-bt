"""
GPU catalog API routes — thin wrappers over GPUService.
"""
from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, Query, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_gpu_service, get_gpu_matching_service, get_subnet_service
from app.schemas.common import APIResponse, PaginationMeta
from app.services.gpu_service import GPUService
from app.services.gpu_matching_service import GPUMatchingService
from app.services.subnet_service import SubnetService

router = APIRouter(prefix="/gpus", tags=["gpus"])


class GPURecommendRequest(BaseModel):
    """Requirements used to rank available GPU offers.

    If `netuid` is supplied and `requirements` is omitted, the most recent
    stored SubnetRequirement for that subnet is used to auto-fill.
    """

    netuid: Optional[int] = None
    requirements: Optional[Dict[str, Any]] = None
    preferred_region: Optional[str] = None
    page: int = 1
    page_size: int = 10


@router.get("", response_model=APIResponse[list[dict]])
async def list_gpu_models(
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    manufacturer: Optional[str] = Query(None, description="NVIDIA, AMD, Intel"),
    min_vram_gb: Optional[float] = Query(None, ge=0),
    min_fp16_tflops: Optional[float] = Query(None, ge=0),
    tier: Optional[str] = Query(None, description="consumer, prosumer, datacenter"),
    gpu_service: GPUService = Depends(get_gpu_service),
) -> APIResponse[list[dict]]:
    models, total = await gpu_service.list_models(
        page=page, page_size=page_size,
        manufacturer=manufacturer, min_vram_gb=min_vram_gb,
        min_fp16_tflops=min_fp16_tflops, tier=tier,
    )
    items = [_serialize_gpu_model(m) for m in models]
    total_pages = (total + page_size - 1) // page_size if total else 0
    meta = PaginationMeta(
        page=page, page_size=page_size, total_items=total,
        total_pages=total_pages, has_next=page < total_pages, has_prev=page > 1,
    )
    return APIResponse(success=True, data=items, meta=meta)


@router.get("/providers", response_model=APIResponse[list[dict]])
async def list_gpu_providers(
    db: AsyncSession = Depends(get_db),
    gpu_service: GPUService = Depends(get_gpu_service),
) -> APIResponse[list[dict]]:
    providers = await gpu_service.list_providers(is_active=True)
    return APIResponse(success=True, data=[_serialize_provider(p) for p in providers])


@router.get("/offers", response_model=APIResponse[list[dict]])
async def list_gpu_offers(
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    provider_id: Optional[str] = Query(None),
    gpu_model_id: Optional[str] = Query(None),
    region: Optional[str] = Query(None),
    min_vram_gb: Optional[float] = Query(None, ge=0),
    max_hourly_price: Optional[float] = Query(None, ge=0),
    is_spot: Optional[bool] = Query(None),
    sort_by: str = Query("hourly_price"),
    sort_order: str = Query("asc", pattern="^(asc|desc)$"),
    gpu_service: GPUService = Depends(get_gpu_service),
) -> APIResponse[list[dict]]:
    offers, total = await gpu_service.list_offers(
        page=page, page_size=page_size,
        provider_id=provider_id, gpu_model_id=gpu_model_id,
        region=region, min_vram_gb=min_vram_gb,
        max_hourly_price=max_hourly_price,
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


@router.get("/offers/cheapest", response_model=APIResponse[dict])
async def cheapest_offer(
    db: AsyncSession = Depends(get_db),
    min_vram_gb: float = Query(24.0, ge=0),
    region: Optional[str] = Query(None),
    gpu_service: GPUService = Depends(get_gpu_service),
) -> APIResponse[dict]:
    offer = await gpu_service.cheapest_offer_for_vram(
        min_vram_gb=min_vram_gb, region=region
    )
    if not offer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No available offer with ≥{min_vram_gb}GB VRAM",
        )
    return APIResponse(success=True, data=_serialize_offer(offer))


def _serialize_gpu_model(m) -> dict:
    return {
        "id": str(m.id) if m.id else None,
        "name": m.name,
        "manufacturer": m.manufacturer,
        "vram_gb": m.vram_gb,
        "cuda_cores": m.cuda_cores,
        "memory_bandwidth_gbps": float(m.memory_bandwidth_gbps) if m.memory_bandwidth_gbps is not None else None,
        "fp16_tflops": float(m.fp16_tflops) if m.fp16_tflops is not None else None,
        "fp32_tflops": float(m.fp32_tflops) if m.fp32_tflops is not None else None,
        "tdp_watts": m.tdp_watts,
        "generation": m.generation,
        "tier": m.tier,
    }


def _serialize_provider(p) -> dict:
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
        "offer_id": o.offer_id,
        "instance_type": o.instance_type,
        "region": o.region,
        "hourly_price": float(o.hourly_price) if o.hourly_price is not None else None,
        "monthly_price": float(o.monthly_price) if o.monthly_price is not None else None,
        "currency": o.currency,
        "availability": o.availability,
        "vram_gb": o.vram_gb,
        "ram_gb": o.ram_gb,
        "cpu_cores": o.cpu_cores,
        "is_spot": o.is_spot,
    }


@router.post("/recommend", response_model=APIResponse[dict])
async def recommend_gpus(
    body: GPURecommendRequest,
    gpu_service: GPUService = Depends(get_gpu_service),
    matching_service: GPUMatchingService = Depends(get_gpu_matching_service),
    subnet_service: SubnetService = Depends(get_subnet_service),
) -> APIResponse[dict]:
    """Rank available GPU offers against a subnet's requirements.

    Provide either explicit `requirements` or a `netuid` (the latest stored
    SubnetRequirement is used). Returns explainable, ranked offers.
    """
    requirements: Dict[str, Any] = dict(body.requirements or {})

    if body.netuid is not None and not requirements:
        req = await subnet_service.get_latest_requirement(body.netuid)
        if req is not None:
            requirements = {
                "min_vram_gb": req.min_vram_gb,
                "recommended_gpu": req.recommended_gpu,
                "cuda_version": req.cuda_version,
            }

    ranked, total = await matching_service.match_offers(
        requirements=requirements,
        preferred_region=body.preferred_region,
        page=body.page,
        page_size=body.page_size,
    )

    data = {
        "netuid": body.netuid,
        "requirements": requirements,
        "total_eligible": total,
        "ranked": [r.to_dict() for r in ranked],
        "model_version": ranked[0].model_version if ranked else None,
    }
    return APIResponse(success=True, data=data)
