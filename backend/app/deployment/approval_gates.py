from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deployment.deployer import DEFAULT_DEPLOYMENT_MODE
from app.models import Deployment
from app.models.audit import ApprovalRequest
from app.providers.registry import PROVIDER_REGISTRY

logger = logging.getLogger(__name__)

STATUS_REQUESTED = "requested"
STATUS_APPROVED = "approved"
STATUS_PROVISIONING = "provisioning"
STATUS_PROVISIONED = "provisioned"
STATUS_STARTED = "started"
STATUS_TERMINATING = "terminating"
STATUS_TERMINATED = "terminated"

ACTION_REQUEST = "deployment.request"
ACTION_PROVISION = "deployment.provision"
ACTION_MIGRATE = "deployment.migrate"


class ApprovalStateError(Exception):
    def __init__(self, deployment_id: str, current_status: str, expected: str):
        self.deployment_id = deployment_id
        self.current_status = current_status
        self.expected = expected
        super().__init__(
            f"Deployment {deployment_id} in status {current_status!r}; expected {expected!r}"
        )


class DoubleApprovalError(Exception):
    def __init__(self, deployment_id: str, action: str):
        self.deployment_id = deployment_id
        self.action = action
        super().__init__(
            f"Deployment {deployment_id} already has an approved "
            f"ApprovalRequest for action {action!r}"
        )


class ApprovalGate:
    def __init__(
        self,
        db: AsyncSession,
        *,
        mode: str | None = None,
    ) -> None:
        self.db = db
        self.mode = mode or DEFAULT_DEPLOYMENT_MODE
        if self.mode not in PROVIDER_REGISTRY:
            raise ValueError(
                f"Unknown deployment mode {self.mode!r}; valid: {sorted(PROVIDER_REGISTRY)}"
            )
        self._provider_cls = PROVIDER_REGISTRY[self.mode]

    async def _load_deployment(self, deployment_id: str) -> Deployment | None:
        stmt = select(Deployment).where(Deployment.id == deployment_id)
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def _existing_approval(
        self, deployment_id: str, action: str
    ) -> ApprovalRequest | None:
        stmt = (
            select(ApprovalRequest)
            .where(
                ApprovalRequest.subject_type == "deployment",
                ApprovalRequest.subject_id == deployment_id,
                ApprovalRequest.action_type == action,
            )
            .order_by(ApprovalRequest.created_at.desc())
            .limit(1)
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    def _utcnow(self) -> datetime:
        return datetime.now(UTC)

    async def approve_request(
        self,
        deployment_id: str,
        *,
        approved_by: str,
        notes: str | None = None,
    ) -> Deployment:
        deployment = await self._load_deployment(deployment_id)
        if deployment is None:
            raise LookupError(f"Deployment {deployment_id} not found")
        if deployment.status != STATUS_REQUESTED:
            raise ApprovalStateError(
                deployment_id, deployment.status, STATUS_REQUESTED
            )

        existing = await self._existing_approval(
            deployment_id, ACTION_REQUEST
        )
        if existing is not None:
            raise DoubleApprovalError(deployment_id, ACTION_REQUEST)

        now = self._utcnow()
        approval = ApprovalRequest(
            action_type=ACTION_REQUEST,
            level="L3_mandatory",
            status="approved",
            requested_by="system",
            approved_by=approved_by,
            subject_type="deployment",
            subject_id=deployment_id,
            payload={},
            reason=notes,
            decided_at=now,
            decision_note=notes,
        )
        self.db.add(approval)

        deployment.status = STATUS_APPROVED
        deployment.approved_at = now
        await self.db.commit()
        await self.db.refresh(deployment)
        return deployment

    async def approve_provision(
        self,
        deployment_id: str,
        *,
        approved_by: str,
        notes: str | None = None,
    ) -> Deployment:
        deployment = await self._load_deployment(deployment_id)
        if deployment is None:
            raise LookupError(f"Deployment {deployment_id} not found")
        if deployment.status != STATUS_APPROVED:
            raise ApprovalStateError(
                deployment_id, deployment.status, STATUS_APPROVED
            )

        existing = await self._existing_approval(
            deployment_id, ACTION_PROVISION
        )
        if existing is not None:
            raise DoubleApprovalError(deployment_id, ACTION_PROVISION)

        now = self._utcnow()
        approval = ApprovalRequest(
            action_type=ACTION_PROVISION,
            level="L3_mandatory",
            status="approved",
            requested_by="system",
            approved_by=approved_by,
            subject_type="deployment",
            subject_id=deployment_id,
            payload={"mode": self.mode},
            reason=notes,
            decided_at=now,
            decision_note=notes,
        )
        self.db.add(approval)

        provider = self._provider_cls()
        server = await provider.provision_server(deployment=deployment)
        self.db.add(server)

        deployment.status = STATUS_PROVISIONED
        deployment.server_id = server.provider_instance_id
        deployment.provisioned_at = now
        await self.db.commit()
        await self.db.refresh(deployment)
        return deployment

    async def approve_migrate(
        self,
        deployment_id: str,
        *,
        approved_by: str,
        notes: str | None = None,
    ) -> Deployment:
        deployment = await self._load_deployment(deployment_id)
        if deployment is None:
            raise LookupError(f"Deployment {deployment_id} not found")
        if deployment.status not in (STATUS_PROVISIONED, STATUS_STARTED):
            raise ApprovalStateError(
                deployment_id,
                deployment.status,
                f"{STATUS_PROVISIONED} or {STATUS_STARTED}",
            )

        existing = await self._existing_approval(
            deployment_id, ACTION_MIGRATE
        )
        if existing is not None:
            raise DoubleApprovalError(deployment_id, ACTION_MIGRATE)

        now = self._utcnow()
        approval = ApprovalRequest(
            action_type=ACTION_MIGRATE,
            level="L3_mandatory",
            status="approved",
            requested_by="system",
            approved_by=approved_by,
            subject_type="deployment",
            subject_id=deployment_id,
            payload={},
            reason=notes,
            decided_at=now,
            decision_note=notes,
        )
        self.db.add(approval)

        deployment.status = STATUS_TERMINATED
        deployment.terminated_at = now
        deployment.error_message = "migrated by operator"
        await self.db.commit()
        await self.db.refresh(deployment)
        return deployment


ApprovalService = ApprovalGate

__all__ = [
    "ACTION_MIGRATE",
    "ACTION_PROVISION",
    "ACTION_REQUEST",
    "STATUS_APPROVED",
    "STATUS_PROVISIONED",
    "STATUS_PROVISIONING",
    "STATUS_REQUESTED",
    "STATUS_STARTED",
    "STATUS_TERMINATED",
    "STATUS_TERMINATING",
    "ApprovalGate",
    "ApprovalService",
    "ApprovalStateError",
    "DoubleApprovalError",
]
