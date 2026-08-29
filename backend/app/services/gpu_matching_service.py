"""
GPU matching service (Phase 6).

Thin orchestration layer that:
  1. Pulls eligible GPU offers from the catalog (via GPUService).
  2. Joins with GPUModel to attach the GPU name.
  3. Calls the pure-Python ranker from `app.intelligence.gpu_matching`.
  4. Returns ranked results.

This is a NEW service — it does not augment GPUService. It composes with it
so the existing read-only catalog layer stays untouched.
"""
import logging
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import GPUOffer, GPUModel
from app.intelligence.gpu_matching import (
    rank_offers_for_requirements,
    RankedOffer,
)

logger = logging.getLogger(__name__)


class GPUMatchingService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _fetch_offer_dicts(
        self,
        min_vram_gb: Optional[float] = None,
        availability: str = "available",
    ) -> List[Dict[str, Any]]:
        """Fetch active offers joined with their GPU model name.

        Filters at the SQL level using `min_vram_gb` (cheap prefilter — the
        pure-Python ranker is the authoritative eligibility gate).
        """
        stmt = (
            select(GPUOffer, GPUModel.name.label("gpu_model_name"))
            .join(GPUModel, GPUOffer.gpu_model_id == GPUModel.id)
            .where(GPUOffer.availability == availability)
        )
        if min_vram_gb is not None and min_vram_gb > 0:
            stmt = stmt.where(GPUOffer.vram_gb >= min_vram_gb)

        result = await self.db.execute(stmt)
        rows = result.all()

        dicts: List[Dict[str, Any]] = []
        for offer, gpu_name in rows:
            d = {
                "id": offer.id,
                "provider_id": offer.provider_id,
                "gpu_model_id": offer.gpu_model_id,
                "gpu_model_name": gpu_name,
                "region": offer.region,
                "hourly_price": offer.hourly_price,
                "monthly_price": offer.monthly_price,
                "currency": offer.currency,
                "availability": offer.availability,
                "vram_gb": offer.vram_gb,
                "ram_gb": offer.ram_gb,
                "storage_gb": offer.storage_gb,
                "is_spot": offer.is_spot,
                "instance_type": offer.instance_type,
            }
            dicts.append(d)
        return dicts

    async def match_offers(
        self,
        requirements: Dict[str, Any],
        preferred_region: Optional[str] = None,
        page: int = 1,
        page_size: int = 10,
    ) -> Tuple[List[RankedOffer], int]:
        """Rank GPU offers for a subnet's requirements.

        Args:
            requirements: SubnetRequirement-shaped dict (from
                `_requirements_to_dict`). Needs at least `min_vram_gb`
                and (optionally) `recommended_gpu`.
            preferred_region: if set, offers in this region get a +0.5 bonus.
            page: 1-based page number.
            page_size: page size for the result list.

        Returns:
            (ranked_offers_for_page, total_eligible_count)
        """
        min_vram = requirements.get("min_vram_gb")
        try:
            min_vram_f = float(min_vram) if min_vram is not None else 0.0
        except (TypeError, ValueError):
            min_vram_f = 0.0

        offer_dicts = await self._fetch_offer_dicts(min_vram_gb=min_vram_f)
        ranked = rank_offers_for_requirements(
            requirements=requirements,
            offers=offer_dicts,
            preferred_region=preferred_region,
        )

        total = len(ranked)
        start = max(0, (page - 1) * page_size)
        end = start + page_size
        return ranked[start:end], total
