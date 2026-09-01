"""
GPU service — read queries against the real ORM models.

Falls back to empty data when the database is not configured (mock/dev mode).
"""
import logging

from sqlalchemy import and_, asc, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import GPUModel, GPUOffer, GPUProvider

logger = logging.getLogger(__name__)


class GPUService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # --- GPU Models ---

    async def list_models(
        self,
        page: int = 1,
        page_size: int = 50,
        manufacturer: str | None = None,
        min_vram_gb: float | None = None,
        min_fp16_tflops: float | None = None,
        tier: str | None = None,
        is_active: bool | None = True,
    ) -> tuple[list[GPUModel], int]:
        query = select(GPUModel)
        if manufacturer:
            query = query.where(GPUModel.manufacturer == manufacturer)
        if min_vram_gb is not None:
            query = query.where(GPUModel.vram_gb >= min_vram_gb)
        if min_fp16_tflops is not None:
            query = query.where(GPUModel.fp16_tflops >= min_fp16_tflops)
        if tier:
            query = query.where(GPUModel.tier == tier)
        if is_active is not None:
            query = query.where(GPUModel.is_active == is_active)

        total = await self.db.scalar(
            select(func.count()).select_from(query.subquery())
        ) or 0
        query = query.order_by(asc(GPUModel.name))
        query = query.offset((page - 1) * page_size).limit(page_size)
        result = await self.db.execute(query)
        return list(result.scalars().all()), total

    async def get_model(self, gpu_id: str) -> GPUModel | None:
        result = await self.db.execute(
            select(GPUModel).where(GPUModel.id == gpu_id)
        )
        return result.scalar_one_or_none()

    # --- Providers ---

    async def list_providers(
        self, is_active: bool | None = True
    ) -> list[GPUProvider]:
        query = select(GPUProvider)
        if is_active is not None:
            query = query.where(GPUProvider.is_active == is_active)
        query = query.order_by(asc(GPUProvider.name))
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_provider(self, provider_id: str) -> GPUProvider | None:
        result = await self.db.execute(
            select(GPUProvider).where(GPUProvider.id == provider_id)
        )
        return result.scalar_one_or_none()

    # --- Offers ---

    async def list_offers(
        self,
        page: int = 1,
        page_size: int = 50,
        provider_id: str | None = None,
        gpu_model_id: str | None = None,
        region: str | None = None,
        min_vram_gb: float | None = None,
        max_hourly_price: float | None = None,
        availability: str | None = "available",
        is_spot: bool | None = None,
        sort_by: str = "hourly_price",
        sort_order: str = "asc",
    ) -> tuple[list[GPUOffer], int]:
        query = select(GPUOffer)
        if provider_id:
            query = query.where(GPUOffer.provider_id == provider_id)
        if gpu_model_id:
            query = query.where(GPUOffer.gpu_model_id == gpu_model_id)
        if region:
            query = query.where(GPUOffer.region == region)
        if min_vram_gb is not None:
            query = query.where(GPUOffer.vram_gb >= min_vram_gb)
        if max_hourly_price is not None:
            query = query.where(GPUOffer.hourly_price <= max_hourly_price)
        if availability is not None:
            query = query.where(GPUOffer.availability == availability)
        if is_spot is not None:
            query = query.where(GPUOffer.is_spot == is_spot)

        total = await self.db.scalar(
            select(func.count()).select_from(query.subquery())
        ) or 0

        col = getattr(GPUOffer, sort_by, GPUOffer.hourly_price)
        query = query.order_by(desc(col) if sort_order == "desc" else asc(col))
        query = query.offset((page - 1) * page_size).limit(page_size)
        result = await self.db.execute(query)
        return list(result.scalars().all()), total

    async def cheapest_offer_for_vram(
        self, min_vram_gb: float = 24.0, region: str | None = None
    ) -> GPUOffer | None:
        """Cheapest available offer meeting a minimum VRAM bar."""
        query = select(GPUOffer).where(
            and_(
                GPUOffer.availability == "available",
                GPUOffer.vram_gb >= min_vram_gb,
            )
        )
        if region:
            query = query.where(GPUOffer.region == region)
        query = query.order_by(asc(GPUOffer.hourly_price)).limit(1)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    # --- Upserts (used by workers / admin) ---

    async def upsert_model(self, model_id: str, **fields) -> GPUModel:
        model = await self.get_model(model_id)
        if model is None:
            model = GPUModel(id=model_id, **fields)
            self.db.add(model)
        else:
            for k, v in fields.items():
                if hasattr(model, k):
                    setattr(model, k, v)
        await self.db.commit()
        await self.db.refresh(model)
        return model
