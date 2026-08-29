"""
Profitability service (Phase 8).

Thin orchestration layer that:
  1. Pulls the trailing emission history for a subnet (from whatever
     emission history source the Bittensor scanner populates).
  2. Pulls the Deployment's `estimated_monthly_cost` + `currency`.
  3. Calls the pure-Python projector in `app.intelligence.profitability`.
  4. Returns the projection.

Like the GPU matching service, this composes — it does NOT augment
the existing scanner / deployment services. The pure projector in
`app.intelligence.profitability` is the authoritative computation;
this layer is just the fetcher.

Phase 8 scope (min-viable):
  - `project(deployment_id, tao_price_usd) -> ProfitabilityProjection`
  - Reads `estimated_monthly_cost` from the Deployment row.
  - Reads trailing emission history from `SubnetEmissionHistory`
    (assuming the Bittensor scanner already populates it; if not,
    this returns an empty-history projection with 0 confidence).
  - `tao_price_usd` is injected by the caller — no live fetch.

NOT in scope (deferred):
  - No persistence of projections to a new `ProfitabilityProjection` table.
  - No drift detection against prior projections.
  - No multi-currency conversion.
  - No recompute loop or scheduled re-projection.
"""
import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Deployment
from app.intelligence.profitability import (
    ProfitabilityProjection,
    project_profitability,
)

logger = logging.getLogger(__name__)


class ProfitabilityService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _fetch_emission_history(
        self,
        netuid: int,
        *,
        limit: int = 7200,
    ) -> List[float]:
        """Pull trailing per-block emissions for a subnet, oldest -> newest.

        Phase 8 uses a thin abstraction: looks for a `SubnetEmissionHistory`
        or similar table populated by the Bittensor scanner. If the table
        does not exist yet (or the netuid has no history), this returns
        `[]` — which yields a valid zero-revenue projection. The service
        NEVER raises on missing history; that's a soft signal, not an error.
        """
        try:
            from app.models import SubnetEmissionHistory  # local import — may not exist
        except ImportError:
            logger.debug("SubnetEmissionHistory not present; returning []")
            return []

        stmt = (
            select(SubnetEmissionHistory.tao_per_block)
            .where(SubnetEmissionHistory.netuid == netuid)
            .order_by(SubnetEmissionHistory.block_number.asc())
            .limit(limit)
        )
        result = await self.db.execute(stmt)
        return [float(v) for v in result.scalars().all() if v is not None]

    async def _fetch_deployment_cost(self, deployment_id: int) -> Optional[Dict[str, Any]]:
        """Pull `estimated_monthly_cost` + `currency` + `netuid` from a Deployment row."""
        stmt = select(
            Deployment.netuid,
            Deployment.estimated_monthly_cost,
            Deployment.currency,
        ).where(Deployment.id == deployment_id)
        row = (await self.db.execute(stmt)).first()
        if row is None:
            return None
        return {
            "netuid": row.netuid,
            "estimated_monthly_cost": row.estimated_monthly_cost,
            "currency": row.currency,
        }

    async def project(
        self,
        deployment_id: int,
        tao_price_usd: float,
        *,
        history_limit: int = 7200,
    ) -> Optional[ProfitabilityProjection]:
        """Compute the profitability projection for a Deployment.

        Returns None if the Deployment row is missing. Returns a
        valid zero-revenue projection if history is empty.
        """
        dep = await self._fetch_deployment_cost(deployment_id)
        if dep is None:
            return None

        history = await self._fetch_emission_history(
            dep["netuid"], limit=history_limit
        )
        return project_profitability(
            emission_history=history,
            monthly_cost_usd=float(dep["estimated_monthly_cost"] or 0.0),
            currency=dep["currency"] or "USD",
            tao_price_usd=float(tao_price_usd),
        )
