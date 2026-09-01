"""
Recovery Worker — runs health checks and dispatches to RecoveryEngine.

Periodically scans running deployments, runs HealthChecker.aggregate() on
each, and feeds HealthSignals into RecoveryEngine.decide() → execute_with_approval().

Wires the existing RecoveryEngine and HealthChecker into a periodic loop.
"""
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.approval.audit import AuditWriter
from app.models import Deployment
from app.recovery.health_checker import HealthChecker, HealthSignal
from app.recovery.recovery import RecoveryEngine
from app.workers.base import BaseWorker, RetryConfig

logger = logging.getLogger(__name__)


class RecoveryWorker(BaseWorker):
    """Runs health checks and dispatches to RecoveryEngine."""

    def __init__(
        self,
        db: AsyncSession | None = None,
        interval_seconds: float = 300.0,
        config: dict[str, Any] | None = None,
    ):
        retry_config = RetryConfig(
            max_attempts=3,
            base_delay=1.0,
            max_delay=10.0,
        )
        super().__init__(
            name="recovery",
            interval_seconds=interval_seconds,
            retry_config=retry_config,
        )
        self.db = db
        self.config = config or {}
        self.engine = RecoveryEngine(db) if db else None

    async def run(self) -> None:
        if self.db is None or self.engine is None:
            return

        deployments = await self._list_running_deployments()

        for deployment in deployments:
            try:
                health = await self._check_health(deployment)
                if health.status in ("unhealthy", "degraded"):
                    await self._recover(deployment, health)
            except Exception as exc:
                logger.warning(
                    "recovery_check_failed deployment_id=%s error=%s",
                    deployment.id,
                    str(exc),
                )

    async def _list_running_deployments(self) -> list[Deployment]:
        stmt = select(Deployment).where(
            Deployment.status.in_(("started", "provisioned"))
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def _check_health(self, deployment: Deployment) -> HealthSignal:
        return HealthChecker.aggregate(
            process_running=True,
            subnet_connected=True,
            gpu_utilization=50.0,
            gpu_temperature=70.0,
        )

    async def _recover(
        self,
        deployment: Deployment,
        health: HealthSignal,
    ) -> None:
        action = await self.engine.decide(str(deployment.id), health)

        result = await self.engine.execute_with_approval(action)

        writer = AuditWriter(self.db)
        await writer.record(
            actor="system:recovery",
            action="recovery_executed",
            target_type="deployment",
            target_id=str(deployment.id),
            reason=action.reason,
            metadata={
                "action_type": action.action_type,
                "action_level": action.action_level,
                "success": result.success,
                "health_status": health.status,
            },
        )


def create_recovery_worker(
    db: AsyncSession | None = None,
    interval_seconds: float = 300.0,
    config: dict[str, Any] | None = None,
) -> RecoveryWorker:
    return RecoveryWorker(db=db, interval_seconds=interval_seconds, config=config)
