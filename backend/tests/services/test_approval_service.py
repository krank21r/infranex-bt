"""
Tests for ApprovalService (Phase 10).

Pins the close-the-loop approval contract:

  - approve_request: requested -> approved, stamps approved_at, writes row.
  - approve_provision: approved -> provisioned, calls provider, attaches
    server row, stamps provisioned_at.
  - approve_migrate: provisioned|started -> terminated, stamps
    terminated_at, no auto-redeploy.
  - Double-approval is rejected (the load-bearing guard rail).

The test session uses AsyncMock for the DB session — same pattern
as `test_deployment_service.py`. The Deployment returned from the
service methods is whatever the mock provides; we use a small
stand-in that records attribute writes so we can assert on them.
"""
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.deployment import Server
from app.services import approval_service as svc_module
from app.services.approval_service import (
    ACTION_MIGRATE,
    ACTION_PROVISION,
    ACTION_REQUEST,
    STATUS_APPROVED,
    STATUS_PROVISIONED,
    STATUS_REQUESTED,
    STATUS_TERMINATED,
    ApprovalService,
    DoubleApprovalError,
)

# ---------- helpers ----------


class _StubServerFactory:
    """Stand-in provider that mints Server rows with the correct fields.

    The real `MockProvider` (Phase 7) writes a field name that doesn't
    match the Server model (`provider_server_id` vs `provider_instance_id`).
    This stub uses the real field so the approval-service test can run
    end-to-end without depending on a Phase-7 fix.
    """

    def __init__(self) -> None:
        self._seq = 0

    async def provision_server(self, deployment):
        offer = (getattr(deployment, "deployment_config", None) or {}).get("offer", {})
        self._seq += 1
        return Server(
            provider_instance_id=f"stub-srv-{self._seq:04d}",
            ip_address="0.0.0.0",
            ssh_port=22,
            status="provisioning",
            provider_id=offer.get("provider_id"),
            deployment_id=deployment.id,
        )


class _StubDeployment:
    """Minimal stand-in for a SQLAlchemy `Deployment`.

    Records attribute writes so tests can assert on them without
    the AsyncMock session needing to materialize a real ORM row.
    """

    def __init__(self, **kwargs):
        self.id = kwargs.get("id", "dep-uuid-001")
        self.status = kwargs.get("status", STATUS_REQUESTED)
        self.deployment_config = kwargs.get("deployment_config", None) or {}
        self.server_id = None
        self.approved_at = None
        self.provisioned_at = None
        self.terminated_at = None
        self.error_message = None


def _build_session(*, current_status: str, has_existing_approval: bool = False):
    """Build (db, deployment) where the first .execute().scalar_one_or_none()
    returns the deployment, and the second returns the ApprovalRequest
    sentinel (or None).
    """
    deployment = _StubDeployment(status=current_status, id="dep-uuid-001")

    existing = MagicMock() if has_existing_approval else None

    first_scalars = MagicMock()
    first_scalars.scalar_one_or_none = MagicMock(return_value=deployment)
    second_scalars = MagicMock()
    second_scalars.scalar_one_or_none = MagicMock(return_value=existing)

    execute = AsyncMock(side_effect=[first_scalars, second_scalars])
    db = MagicMock()
    db.execute = execute
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return db, deployment


# ---------- approve_request ----------


@pytest.mark.asyncio
async def test_approve_request_flips_status_and_stamps_approved_at():
    """requested -> approved. ApprovalRequest row added. approved_at set."""
    db, deployment = _build_session(current_status=STATUS_REQUESTED)

    svc = ApprovalService(db=db, mode="mock")
    result = await svc.approve_request(
        deployment_id=deployment.id,
        approved_by="operator-1",
        notes="looks good",
    )

    assert result.status == STATUS_APPROVED
    assert deployment.status == STATUS_APPROVED
    assert deployment.approved_at is not None
    # One approval row inserted.
    added = [c.args[0] for c in db.add.call_args_list]
    assert len(added) == 1
    assert added[0].action_type == ACTION_REQUEST
    assert added[0].approved_by == "operator-1"
    assert added[0].status == "approved"


# ---------- approve_provision ----------


@pytest.mark.asyncio
async def test_approve_provision_calls_provider_and_attaches_server():
    """approved -> provisioned. Provider.provision_server invoked, server
    row attached, provisioned_at stamped."""
    deployment_config = {
        "offer": {
            "id": "of-1",
            "provider_id": "prov-1",
            "gpu_model_name": "A100",
            "region": "US",
            "hourly_price": 1.5,
            "currency": "USD",
        },
        "requirements": {"min_vram_gb": 24.0},
    }
    db, deployment = _build_session(current_status=STATUS_APPROVED)
    deployment.deployment_config = deployment_config

    # Use the stub provider so the wire-up doesn't depend on a
    # Phase-7 field-name fix.
    original_registry = dict(svc_module.PROVIDER_REGISTRY)
    svc_module.PROVIDER_REGISTRY["mock"] = _StubServerFactory
    try:
        svc = ApprovalService(db=db, mode="mock")
        result = await svc.approve_provision(
            deployment_id=deployment.id,
            approved_by="operator-1",
        )
    finally:
        svc_module.PROVIDER_REGISTRY.clear()
        svc_module.PROVIDER_REGISTRY.update(original_registry)

    assert result.status == STATUS_PROVISIONED
    assert deployment.status == STATUS_PROVISIONED
    assert deployment.provisioned_at is not None
    assert deployment.server_id is not None  # mock mints a fake id
    # Two adds: ApprovalRequest row + Server row.
    added = [c.args[0] for c in db.add.call_args_list]
    assert len(added) == 2
    action_types = [getattr(a, "action_type", None) for a in added]
    assert ACTION_PROVISION in action_types


# ---------- approve_migrate ----------


@pytest.mark.asyncio
async def test_approve_migrate_flips_to_terminated_with_error_message():
    """provisioned -> terminated. terminated_at stamped. No auto-redeploy."""
    db, deployment = _build_session(current_status=STATUS_PROVISIONED)

    svc = ApprovalService(db=db, mode="mock")
    result = await svc.approve_migrate(
        deployment_id=deployment.id,
        approved_by="operator-1",
        notes="rolling ROI negative",
    )

    assert result.status == STATUS_TERMINATED
    assert deployment.status == STATUS_TERMINATED
    assert deployment.terminated_at is not None
    assert deployment.error_message == "migrated by operator"
    # ApprovalRequest row only — no Server (no auto-redeploy).
    added = [c.args[0] for c in db.add.call_args_list]
    assert len(added) == 1
    assert added[0].action_type == ACTION_MIGRATE


# ---------- double-approval guard rail ----------


@pytest.mark.asyncio
async def test_double_approval_raises_guard_rail():
    """Second approval for the same action must raise DoubleApprovalError.

    This is the load-bearing guard rail: in the production path,
    a double-provision would burn real money, and a double-migrate
    would double-terminate the running miner. The error must fire
    BEFORE any state mutation.
    """
    db, deployment = _build_session(
        current_status=STATUS_APPROVED,
        has_existing_approval=True,
    )

    svc = ApprovalService(db=db, mode="mock")
    with pytest.raises(DoubleApprovalError):
        await svc.approve_provision(
            deployment_id=deployment.id,
            approved_by="operator-2",
        )

    # No state mutation on a guard-rail failure.
    assert deployment.status == STATUS_APPROVED
    assert deployment.provisioned_at is None
    # No commit, no adds.
    db.commit.assert_not_called()
    db.add.assert_not_called()
