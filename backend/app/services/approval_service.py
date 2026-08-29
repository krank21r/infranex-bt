"""
Deployment approval orchestrator (Phase 10).

Closes the loop on the deployment engine by implementing the
3-level approval flow that the Phase 7 service only sketched:

    request  ->  approved  ->  provisioning  ->  provisioned  ->  started
                                                                    |
                                                                    v
                                                                terminating
                                                                    |
                                                                    v
                                                                terminated

Phase 10 scope (min-viable, per user decisions):
  - `ApprovalService(db, mode=None)` — the deployment-side approval
    orchestrator (NOT the generic audit-trail service in
    `app/approval/service.py`).
  - Three per-action methods, each guarded on the current
    Deployment.status:
      * `approve_request(deployment_id, *, approved_by, notes=None)`
        requested -> approved. Pure status flip + ApprovalRequest row.
      * `approve_provision(deployment_id, *, approved_by, notes=None)`
        approved -> provisioning -> provisioned. Calls the
        registered provider's `provision_server` and attaches a
        Server row to the deployment.
      * `approve_migrate(deployment_id, *, approved_by, notes=None)`
        provisioned|started -> terminating -> terminated. No
        auto-redeploy — the operator picks the next subnet out of band.
  - Double-approval is rejected (the load-bearing guard rail).
  - Per-action grain: each transition is its own approval row.
  - DB row only for the token (no signed JWT, no TTL).
  - DB-only side effects (no webhooks, no notifications).

NOT in scope (deferred):
  - Auto-migration (the operator still picks the replacement subnet).
  - Notification / webhook when a state transitions.
  - SSH health check loop.
  - Re-run of compatibility test before provision.
  - The `started` transition (provisioned -> started is a runtime
    concern; the operator marks the miner as started out of band).
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Deployment
from app.models.audit import ApprovalRequest
from app.services.deployment_service import (
    PROVIDER_REGISTRY,
    DEFAULT_DEPLOYMENT_MODE,
)

logger = logging.getLogger(__name__)


# Status constants — single source of truth, matches the spec.
STATUS_REQUESTED = "requested"
STATUS_APPROVED = "approved"
STATUS_PROVISIONING = "provisioning"
STATUS_PROVISIONED = "provisioned"
STATUS_STARTED = "started"
STATUS_TERMINATING = "terminating"
STATUS_TERMINATED = "terminated"

# Action labels for ApprovalRequest.action_type (audit-trail).
ACTION_REQUEST = "deployment.request"
ACTION_PROVISION = "deployment.provision"
ACTION_MIGRATE = "deployment.migrate"


class ApprovalStateError(Exception):
    """Raised when an approval is requested in the wrong state.

    Example: calling `approve_provision` on a deployment whose
    status is still 'requested' (must be 'approved' first).
    """

    def __init__(self, deployment_id: str, current_status: str, expected: str):
        self.deployment_id = deployment_id
        self.current_status = current_status
        self.expected = expected
        super().__init__(
            f"Deployment {deployment_id} in status {current_status!r}; "
            f"expected {expected!r}"
        )


class DoubleApprovalError(Exception):
    """Raised when a second approval is attempted for an already-approved action.

    The guard rail: once `approved_at` is set on the matching
    ApprovalRequest, the action is no longer pending. This prevents
    accidental double-provisioning (which would burn real money in
    the production path) and double-migration (which would
    double-terminate the running miner).
    """

    def __init__(self, deployment_id: str, action: str):
        self.deployment_id = deployment_id
        self.action = action
        super().__init__(
            f"Deployment {deployment_id} already has an approved "
            f"ApprovalRequest for action {action!r}"
        )


class ApprovalService:
    """Deployment-state orchestrator.

    Composes with `app.approval.service.ApprovalService` (the
    generic audit-trail writer) by inserting an `ApprovalRequest`
    row on each transition. This class is the state-machine driver;
    the generic one is the audit writer.
    """

    def __init__(
        self,
        db: AsyncSession,
        *,
        mode: Optional[str] = None,
    ) -> None:
        self.db = db
        self.mode = mode or DEFAULT_DEPLOYMENT_MODE
        if self.mode not in PROVIDER_REGISTRY:
            raise ValueError(
                f"Unknown deployment mode {self.mode!r}; "
                f"valid: {sorted(PROVIDER_REGISTRY)}"
            )
        self._provider_cls = PROVIDER_REGISTRY[self.mode]

    # ---------- internals ----------

    async def _load_deployment(self, deployment_id: str) -> Optional[Deployment]:
        """Fetch a Deployment by id; None if missing."""
        stmt = select(Deployment).where(Deployment.id == deployment_id)
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def _existing_approval(
        self, deployment_id: str, action: str
    ) -> Optional[ApprovalRequest]:
        """Return the most recent ApprovalRequest for (deployment, action).

        Used by the double-approval guard rail.
        """
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
        return datetime.now(timezone.utc)

    # ---------- approve_request ----------

    async def approve_request(
        self,
        deployment_id: str,
        *,
        approved_by: str,
        notes: Optional[str] = None,
    ) -> Deployment:
        """Approve a 'requested' deployment: flips status to 'approved'.

        Guard: must currently be in 'requested'. Records an
        ApprovalRequest row with status='approved'. Stamps
        `approved_at` on the deployment.

        Raises:
            ApprovalStateError: if deployment is missing or in any
                state other than 'requested'.
            DoubleApprovalError: if a request-approval already exists
                for this deployment (the load-bearing guard rail).
        """
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
        deployment.approved_at = now  # type: ignore[attr-defined]
        await self.db.commit()
        await self.db.refresh(deployment)
        return deployment

    # ---------- approve_provision ----------

    async def approve_provision(
        self,
        deployment_id: str,
        *,
        approved_by: str,
        notes: Optional[str] = None,
    ) -> Deployment:
        """Approve provisioning: 'approved' -> 'provisioning' -> 'provisioned'.

        Calls the registered provider's `provision_server` to mint
        a Server row, then attaches it to the deployment and flips
        the status to 'provisioned'. In mock mode the server is a
        stable fake; in production this is where real money changes
        hands.

        Guard: must currently be in 'approved'. Raises
        ApprovalStateError / DoubleApprovalError like the others.

        Returns the deployment with `server_id` populated and
        `provisioned_at` stamped.
        """
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

        # Provisioning -> provisioned via the registered provider.
        provider = self._provider_cls()
        # `offer` was snapshotted into deployment_config at request time;
        # the provider reads it from there.
        server = await provider.provision_server(deployment=deployment)
        self.db.add(server)

        deployment.status = STATUS_PROVISIONED
        # Use the provider's stable id (e.g. mock-srv-0001). The DB
        # primary key is not yet assigned at this point in the
        # transaction; the relationship is by the provider id.
        deployment.server_id = server.provider_instance_id  # type: ignore[attr-defined]
        deployment.provisioned_at = now  # type: ignore[attr-defined]
        await self.db.commit()
        await self.db.refresh(deployment)
        return deployment

    # ---------- approve_migrate ----------

    async def approve_migrate(
        self,
        deployment_id: str,
        *,
        approved_by: str,
        notes: Optional[str] = None,
    ) -> Deployment:
        """Approve migration: 'provisioned'|'started' -> 'terminating' -> 'terminated'.

        Records the approval row, stamps `terminated_at` on the
        deployment, and flips status. No auto-redeploy — the
        operator chooses the next subnet out of band.

        Guard: must currently be in 'provisioned' OR 'started'.
        Raises ApprovalStateError / DoubleApprovalError like the others.
        """
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
        deployment.terminated_at = now  # type: ignore[attr-defined]
        deployment.error_message = "migrated by operator"  # type: ignore[attr-defined]
        await self.db.commit()
        await self.db.refresh(deployment)
        return deployment
