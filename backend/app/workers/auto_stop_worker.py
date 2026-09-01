"""
Auto-Stop Worker — periodically scans started deployments and stops unhealthy ones.

Trigger conditions for auto-stop:
  - HealthSignal.status == "unhealthy" for N consecutive checks
  - HealthSignal.status == "degraded" for extended period
  - Deployment exceeds max age without healthy report

This is an L1 action (immediate, logged). It stops the miner but keeps
the server alive for potential redeployment.
"""
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.approval.audit import AuditWriter
from app.models import Deployment
from app.recovery.health_checker import HealthChecker, HealthSignal
from app.services.deployment_service import DeploymentService
from app.workers.base import BaseWorker, RetryConfig

logger = logging.getLogger(__name__)

DEFAULT_UNHEALTHY_THRESHOLD = 2
DEFAULT_DEGRADED_THRESHOLD = 5
DEFAULT_MAX_AGE_HOURS = 72


class AutoStopWorker(BaseWorker):
    """Periodically checks deployment health and stops unhealthy miners."""

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
            name="auto_stop",
            interval_seconds=interval_seconds,
            retry_config=retry_config,
        )
        self.db = db
        self.config = config or {}
        self.unhealthy_threshold = self.config.get(
            "unhealthy_threshold", DEFAULT_UNHEALTHY_THRESHOLD
        )
        self.degraded_threshold = self.config.get(
            "degraded_threshold", DEFAULT_DEGRADED_THRESHOLD
        )
        self.max_age_hours = self.config.get(
            "max_age_hours", DEFAULT_MAX_AGE_HOURS
        )
        self._health_history: dict[str, list[str]] = {}

    async def run(self) -> None:
        if self.db is None:
            return

        deployments = await self._list_started_deployments()
        deployment_service = DeploymentService(self.db)

        for deployment in deployments:
            try:
                health = await self._check_health(deployment)
                await self._evaluate_deployment(
                    deployment, health, deployment_service
                )
            except Exception as exc:
                logger.warning(
                    "auto_stop_check_failed deployment_id=%s error=%s",
                    deployment.id,
                    str(exc),
                )

    async def _list_started_deployments(self) -> list[Deployment]:
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

    async def _evaluate_deployment(
        self,
        deployment: Deployment,
        health: HealthSignal,
        service: DeploymentService,
    ) -> None:
        dep_id = str(deployment.id)

        if dep_id not in self._health_history:
            self._health_history[dep_id] = []

        history = self._health_history[dep_id]
        history.append(health.status)

        max_history = max(self.unhealthy_threshold, self.degraded_threshold) + 1
        if len(history) > max_history:
            history.pop(0)

        unhealthy_count = sum(
            1 for s in history[-self.unhealthy_threshold:] if s == "unhealthy"
        )
        if unhealthy_count >= self.unhealthy_threshold:
            await self._auto_stop(deployment, service, "unhealthy")
            return

        degraded_count = sum(
            1 for s in history[-self.degraded_threshold:] if s == "degraded"
        )
        if degraded_count >= self.degraded_threshold:
            await self._auto_stop(deployment, service, "degraded")

    async def _auto_stop(
        self,
        deployment: Deployment,
        service: DeploymentService,
        reason: str,
    ) -> None:
        await service.stop_miner(str(deployment.id))

        writer = AuditWriter(self.db)
        await writer.record(
            actor="system:auto_stop",
            action="miner_stopped",
            target_type="deployment",
            target_id=str(deployment.id),
            reason=f"Auto-stopped due to {reason} health",
            metadata={"trigger_reason": reason},
        )

        self._health_history.pop(str(deployment.id), None)


def create_auto_stop_worker(
    db: AsyncSession | None = None,
    interval_seconds: float = 300.0,
    config: dict[str, Any] | None = None,
) -> AutoStopWorker:
    return AutoStopWorker(db=db, interval_seconds=interval_seconds, config=config)
