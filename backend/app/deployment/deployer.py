from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.approval.classifier import ActionLevel
from app.deployment.state_machine import DeploymentState, assert_can_transition
from app.models import Deployment, Server
from app.providers.base import GPUProvider
from app.providers.registry import PROVIDER_REGISTRY, get_provider

logger = logging.getLogger(__name__)

DEFAULT_DEPLOYMENT_MODE = "mock"
VALID_MODES = set(PROVIDER_REGISTRY.keys())


def _get_provider(mode: str | None = None) -> GPUProvider:
    return get_provider(mode or DEFAULT_DEPLOYMENT_MODE)


@dataclass(frozen=True)
class CostProjection:
    hourly_price: float
    currency: str
    hours_per_month: int = 730

    @property
    def monthly(self) -> float:
        return round(float(self.hourly_price) * self.hours_per_month, 2)


def build_deployment_config(
    offer: dict[str, Any],
    requirements: dict[str, Any],
) -> dict[str, Any]:
    return {
        "offer": {
            "id": offer.get("id"),
            "provider_id": offer.get("provider_id"),
            "gpu_model_id": offer.get("gpu_model_id"),
            "gpu_model_name": offer.get("gpu_model_name"),
            "region": offer.get("region"),
            "vram_gb": offer.get("vram_gb"),
            "ram_gb": offer.get("ram_gb"),
            "storage_gb": offer.get("storage_gb"),
            "instance_type": offer.get("instance_type"),
            "is_spot": offer.get("is_spot"),
        },
        "requirements": {
            "min_vram_gb": requirements.get("min_vram_gb"),
            "recommended_gpu": requirements.get("recommended_gpu"),
            "python_version": requirements.get("python_version"),
            "docker_required": requirements.get("docker_required"),
            "nvidia_runtime_required": requirements.get("nvidia_runtime_required"),
            "ports": requirements.get("ports") or [],
            "startup_command": requirements.get("startup_command"),
            "miner_command": requirements.get("miner_command"),
        },
    }


async def fetch_deployment(db: AsyncSession, deployment_id: str) -> Deployment:
    row = await db.get(Deployment, deployment_id)
    if row is None:
        raise ValueError(f"Deployment {deployment_id} not found")
    return row


async def transition(
    db: AsyncSession,
    deployment: Deployment,
    to_state: str | DeploymentState,
    *,
    error_message: str | None = None,
) -> None:
    result = assert_can_transition(deployment.status, to_state)
    if not result.allowed:
        raise ValueError(result.reason)
    deployment.status = DeploymentState(to_state).value
    if error_message:
        deployment.error_message = error_message
    await db.flush()


async def approval_gate(
    db: AsyncSession,
    deployment: Deployment,
    action_type: str,
    level: ActionLevel,
    requested_by: str = "system:deployment-engine",
) -> str:
    from app.approval.service import ApprovalRequestInput, ApprovalService

    svc = ApprovalService(db)
    payload = {"deployment_id": deployment.id, "netuid": deployment.netuid}
    approval_id = await svc.create(
        ApprovalRequestInput(
            action_type=action_type,
            level=level,
            requested_by=requested_by,
            subject_type="deployment",
            subject_id=deployment.id,
            payload=payload,
        )
    )
    logger.info(
        "Approval gate created: id=%s action=%s level=%s",
        approval_id,
        action_type,
        level.value,
    )
    return approval_id


class Deployer:
    def __init__(self, db: AsyncSession, mode: str | None = None) -> None:
        self.db = db
        self.mode = (mode or os.getenv("DEPLOYMENT_MODE") or DEFAULT_DEPLOYMENT_MODE).lower()
        self._provider = _get_provider(self.mode)

    @property
    def provider(self) -> GPUProvider:
        return self._provider

    async def request_deployment(
        self,
        netuid: int,
        offer: dict[str, Any],
        requirements: dict[str, Any],
        *,
        hotkey_address: str | None = None,
    ) -> Deployment:
        cost = CostProjection(
            hourly_price=float(offer.get("hourly_price") or 0.0),
            currency=offer.get("currency") or "USD",
        )
        config = build_deployment_config(offer, requirements)

        deployment = Deployment(
            netuid=netuid,
            status="requested",
            currency=cost.currency,
            estimated_monthly_cost=cost.monthly,
            estimated_monthly_revenue=None,
            deployment_config=config,
            hotkey_address=hotkey_address,
        )
        self.db.add(deployment)
        await self.db.flush()
        return deployment

    async def approve_deployment(self, deployment_id: str) -> Deployment:
        deployment = await fetch_deployment(self.db, deployment_id)
        if deployment.status != DeploymentState.REQUESTED.value:
            raise ValueError(
                f"Cannot approve deployment in state {deployment.status}; expected requested"
            )
        await approval_gate(
            self.db,
            deployment,
            action_type="approve_drift_correction",
            level=ActionLevel.L3_MANDATORY,
        )
        await transition(self.db, deployment, DeploymentState.APPROVED)
        deployment.approved_at = datetime.now(UTC)
        await self.db.flush()
        return deployment

    async def provision_server(
        self,
        deployment_id: str,
        offer: dict[str, Any],
    ) -> Deployment:
        deployment = await fetch_deployment(self.db, deployment_id)
        if deployment.status != DeploymentState.APPROVED.value:
            raise ValueError(
                f"Cannot provision deployment in state {deployment.status}; expected approved"
            )
        await transition(self.db, deployment, DeploymentState.PROVISIONING)
        if deployment.deployment_config is None:
            deployment.deployment_config = {}
        deployment.deployment_config["offer"] = offer
        server = await self.provider.provision_server(deployment)
        self.db.add(server)
        deployment.server_id = server.id
        await self.db.flush()
        await transition(self.db, deployment, DeploymentState.PROVISIONED)
        deployment.provisioned_at = datetime.now(UTC)
        await self.db.flush()
        return deployment

    async def setup_server(self, deployment_id: str) -> Deployment:
        deployment = await fetch_deployment(self.db, deployment_id)
        if deployment.status != DeploymentState.PROVISIONED.value:
            raise ValueError(
                f"Cannot setup deployment in state {deployment.status}; expected provisioned"
            )
        await transition(self.db, deployment, DeploymentState.SETUP)
        requirements = (
            deployment.deployment_config.get("requirements", {}) if deployment.deployment_config else {}
        )
        stmt = select(Server).where(Server.deployment_id == deployment.id)
        result = await self.db.execute(stmt)
        server = result.scalar_one_or_none()
        if server is None:
            raise ValueError("Server not found for deployment")
        try:
            from app.deployment.setup import validate_compatibility
            compat = validate_compatibility(
                {
                    "id": server.id,
                    "provider_instance_id": server.provider_instance_id,
                    "gpu_model": server.gpu_model,
                    "vram_gb": server.vram_gb,
                    "docker_supported": True,
                },
                requirements,
            )
            if not compat.compatible:
                raise ValueError(
                    "Server incompatible: " + "; ".join(compat.missing_capabilities)
                )
            from app.deployment.setup import generate_setup_script
            script = generate_setup_script(requirements)
            server.extra_metadata = {**(server.extra_metadata or {}), "setup_script": script}
            await self.db.flush()
        except Exception as exc:
            raise ValueError(f"Setup failed: {exc}") from exc
        await transition(self.db, deployment, DeploymentState.READY)
        await self.db.flush()
        return deployment

    async def deploy_miner(self, deployment_id: str) -> Deployment:
        deployment = await fetch_deployment(self.db, deployment_id)
        if deployment.status != DeploymentState.READY.value:
            raise ValueError(
                f"Cannot deploy miner in state {deployment.status}; expected ready"
            )
        await approval_gate(
            self.db,
            deployment,
            action_type="deploy_new_miner",
            level=ActionLevel.L3_MANDATORY,
        )
        await transition(self.db, deployment, DeploymentState.DEPLOYING)
        await self.db.flush()
        stmt = select(Server).where(Server.deployment_id == deployment.id)
        result = await self.db.execute(stmt)
        server = result.scalar_one_or_none()
        if server:
            server.status = "running"
        await transition(self.db, deployment, DeploymentState.STARTED)
        deployment.started_at = datetime.now(UTC)
        await self.db.flush()
        return deployment

    async def stop_miner(self, deployment_id: str) -> Deployment:
        deployment = await fetch_deployment(self.db, deployment_id)
        if deployment.status != DeploymentState.STARTED.value:
            raise ValueError(
                f"Cannot stop miner in state {deployment.status}; expected started"
            )
        await transition(self.db, deployment, DeploymentState.STOPPING)
        stmt = select(Server).where(Server.deployment_id == deployment.id)
        result = await self.db.execute(stmt)
        server = result.scalar_one_or_none()
        if server:
            server.status = "stopped"
        await transition(self.db, deployment, DeploymentState.STOPPED)
        deployment.stopped_at = datetime.now(UTC)
        await self.db.flush()
        return deployment

    async def redeploy_miner(self, deployment_id: str) -> Deployment:
        deployment = await fetch_deployment(self.db, deployment_id)

        if deployment.status == DeploymentState.STARTED.value:
            await self.stop_miner(deployment_id)

        stmt = select(Server).where(Server.deployment_id == deployment.id)
        result = await self.db.execute(stmt)
        server = result.scalar_one_or_none()
        if server:
            self.provider.terminate_server(server)
            server.status = "terminated"
            server.terminated_at = datetime.now(UTC)

        deployment.status = DeploymentState.APPROVED.value
        await self.db.flush()

        offer = (deployment.deployment_config or {}).get("offer", {})
        await self.provision_server(deployment_id, offer)
        await self.setup_server(deployment_id)
        return await self.deploy_miner(deployment_id)

    async def terminate_deployment(
        self,
        deployment_id: str,
        *,
        reason: str | None = None,
        force: bool = False,
    ) -> Deployment:
        deployment = await fetch_deployment(self.db, deployment_id)
        terminal_states = {
            DeploymentState.TERMINATED.value,
            DeploymentState.STOPPED.value,
            DeploymentState.FAILED.value,
        }
        if deployment.status not in terminal_states and not force:
            await transition(self.db, deployment, DeploymentState.TERMINATED)
        deployment.status = DeploymentState.TERMINATED.value
        deployment.terminated_at = datetime.now(UTC)
        if reason:
            deployment.error_message = reason
        stmt = select(Server).where(Server.deployment_id == deployment.id)
        result = await self.db.execute(stmt)
        server = result.scalar_one_or_none()
        if server:
            server.status = "terminated"
            server.terminated_at = datetime.now(UTC)
        await self.db.flush()
        return deployment


DeploymentService = Deployer

__all__ = [
    "DEFAULT_DEPLOYMENT_MODE",
    "VALID_MODES",
    "CostProjection",
    "Deployer",
    "DeploymentService",
    "approval_gate",
    "build_deployment_config",
    "fetch_deployment",
    "transition",
]
