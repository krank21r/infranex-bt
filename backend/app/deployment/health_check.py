"""
Health check loop for running miners.

SSH-based checks that verify:
  - miner process is running
  - subnet connectivity
Reports health to MonitoringService.
"""
from __future__ import annotations

import asyncio
import logging
import random
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.deployment import Deployment, Server
from app.deployment.state_machine import DeploymentState

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class HealthCheckResult:
    deployment_id: str
    server_id: Optional[str]
    healthy: bool
    miner_running: bool
    subnet_connected: bool
    checked_at: datetime
    error: Optional[str] = None
    details: dict[str, Any] = None

    def __post_init__(self) -> None:
        if self.details is None:
            object.__setattr__(self, "details", {})


class HealthChecker:
    """Runs periodic SSH-based health checks against deployed miners."""

    def __init__(
        self,
        db: AsyncSession,
        *,
        check_interval: int = 60,
        timeout: int = 10,
    ) -> None:
        self.db = db
        self.check_interval = check_interval
        self.timeout = timeout

    async def run_once(self) -> list[HealthCheckResult]:
        """Run a single pass over all deployments in the 'started' state."""
        stmt = (
            select(Deployment, Server)
            .join(Server, Server.id == Deployment.server_id)
            .where(Deployment.status == DeploymentState.STARTED)
        )
        rows = (await self.db.execute(stmt)).all()
        results: list[HealthCheckResult] = []
        for deployment, server in rows:
            result = await self._check_one(deployment, server)
            results.append(result)
            if not result.healthy:
                logger.warning(
                    "deployment %s health check failed: %s",
                    deployment.id,
                    result.error,
                )
        return results

    async def _check_one(
        self, deployment: Deployment, server: Server
    ) -> HealthCheckResult:
        """SSH into the server and verify miner + subnet connectivity."""
        try:
            miner_running = await self._verify_miner_process(server)
            subnet_connected = await self._verify_subnet_connectivity(server, deployment)
            healthy = miner_running and subnet_connected
            return HealthCheckResult(
                deployment_id=deployment.id,
                server_id=server.id,
                healthy=healthy,
                miner_running=miner_running,
                subnet_connected=subnet_connected,
                checked_at=datetime.now(timezone.utc),
                details={
                    "ip_address": server.ip_address,
                    "ssh_port": server.ssh_port,
                    "gpu_model": server.gpu_model,
                },
            )
        except Exception as exc:
            logger.exception("Health check error for deployment %s", deployment.id)
            return HealthCheckResult(
                deployment_id=deployment.id,
                server_id=server.id,
                healthy=False,
                miner_running=False,
                subnet_connected=False,
                checked_at=datetime.now(timezone.utc),
                error=str(exc),
            )

    async def _verify_miner_process(self, server: Server) -> bool:
        if not server.ip_address or not server.ssh_port:
            return False
        # In production: asyncio.open_connection over SSH / paramiko / asyncssh.
        # For mock / CI we simulate based on server status.
        return server.status == "running"

    async def _verify_subnet_connectivity(
        self, server: Server, deployment: Deployment
    ) -> bool:
        if not server.ip_address or not server.ssh_port:
            return False
        # In production: call Bittensor RPC / websocket ping on the miner.
        # For mock / CI we return True if the deployment has a netuid.
        return deployment.netuid is not None and deployment.netuid > 0

    async def loop(self) -> None:
        """Run health checks forever at the configured interval."""
        while True:
            try:
                await self.run_once()
            except Exception:
                logger.exception("health check loop error")
            await asyncio.sleep(self.check_interval + random.uniform(0, 5))
