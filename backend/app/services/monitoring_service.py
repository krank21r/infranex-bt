"""
Monitoring service (Phase 9).

Thin orchestration layer that:
  1. Pulls recent (block, tao_per_block) observations for a subnet
     from the emissions history table.
  2. Pulls the Deployment's `estimated_monthly_cost` + `netuid`.
  3. Calls the pure-Python migrator in `app.intelligence.monitoring`.
  4. Returns the MigrateSignal.

Like the other Phase X services, this composes — it does NOT augment
the existing scanner / deployment / profitability services. The pure
`should_migrate` function is the authoritative decision; this layer
is the fetcher.

Phase 9 scope (min-viable):
  - `should_migrate_for_deployment(deployment_id, tao_price_usd, *,
      history_limit, min_observations) -> Optional[MigrateSignal]`
  - Returns None if the Deployment row is missing.
  - Returns a False signal with reason="insufficient data" if the
    observation list is empty (no emissions recorded yet).

NOT in scope (deferred):
  - No live scheduler / cron. The service is callable; the loop is
    a separate concern.
  - No `MigrateSignal` DB row. The signal is in-memory only.
  - No notification / webhook when should_migrate flips True.
  - No persistence of the observation list (assumes the Bittensor
    scanner populates `SubnetEmissionHistory`; this service only
    reads it).
"""
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.intelligence.monitoring import (
    DEFAULT_MIN_OBSERVATIONS,
    DEFAULT_ROLLING_WINDOW,
    MigrateSignal,
    should_migrate,
)
from app.models import Deployment

logger = logging.getLogger(__name__)


class MonitoringService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _fetch_observations(
        self,
        netuid: int,
        *,
        limit: int = DEFAULT_ROLLING_WINDOW,
    ) -> list[tuple[int, float]]:
        """Pull trailing (block, tao_per_block) observations for a subnet.

        Soft-imports `SubnetEmissionHistory`. If the table is absent
        (Phase 9 ships before the scanner populates it), returns []
        — never raises. That's a "no data yet" signal, not an error.
        """
        try:
            from app.models import SubnetEmissionHistory
        except ImportError:
            logger.debug("SubnetEmissionHistory not present; returning []")
            return []

        stmt = (
            select(
                SubnetEmissionHistory.block_number,
                SubnetEmissionHistory.tao_per_block,
            )
            .where(SubnetEmissionHistory.netuid == netuid)
            .order_by(SubnetEmissionHistory.block_number.desc())
            .limit(limit)
        )
        rows = (await self.db.execute(stmt)).all()
        # The pure layer expects oldest -> newest; we fetched newest first.
        return [(int(b), float(t)) for b, t in reversed(rows)]

    async def _fetch_deployment_cost(self, deployment_id: int) -> dict | None:
        """Pull netuid + estimated_monthly_cost from a Deployment row."""
        stmt = select(
            Deployment.netuid,
            Deployment.estimated_monthly_cost,
        ).where(Deployment.id == deployment_id)
        row = (await self.db.execute(stmt)).first()
        if row is None:
            return None
        return {
            "netuid": row.netuid,
            "estimated_monthly_cost": row.estimated_monthly_cost,
        }

    async def should_migrate_for_deployment(
        self,
        deployment_id: int,
        tao_price_usd: float,
        *,
        history_limit: int = DEFAULT_ROLLING_WINDOW,
        min_observations: int = DEFAULT_MIN_OBSERVATIONS,
    ) -> MigrateSignal | None:
        """Compute the migrate signal for one Deployment.

        Returns None if the Deployment row is missing. Returns a False
        signal with `reason="insufficient data"` if no observations
        have been recorded yet — that's the load-bearing "don't fire
        on the first block" invariant.
        """
        dep = await self._fetch_deployment_cost(deployment_id)
        if dep is None:
            return None

        observations = await self._fetch_observations(
            dep["netuid"], limit=history_limit
        )
        return should_migrate(
            observations=observations,
            monthly_cost_usd=float(dep["estimated_monthly_cost"] or 0.0),
            tao_price_usd=float(tao_price_usd),
            min_observations=min_observations,
            window=history_limit,
        )
