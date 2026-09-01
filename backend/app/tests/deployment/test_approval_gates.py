from __future__ import annotations

import sys
import types
from unittest.mock import AsyncMock, MagicMock

import pytest

_STUB_MODULES = {
    "sqlalchemy": [
        ("String", str),
        ("Integer", int),
        ("Float", float),
        ("Text", str),
        ("Boolean", bool),
        ("DateTime", object),
        ("JSON", object),
        ("func", types.SimpleNamespace(now=lambda: None)),
        ("select", MagicMock()),
        ("update", MagicMock()),
        ("insert", MagicMock()),
        ("and_", lambda *a: a),
        ("text", lambda s: s),
        ("create_engine", MagicMock()),
        ("create_async_engine", MagicMock()),
    ],
    "sqlalchemy.dialects": [],
    "sqlalchemy.dialects.postgresql": [
        ("UUID", str),
        ("JSONB", dict),
        ("ARRAY", list),
    ],
    "sqlalchemy.orm": [
        ("Mapped", type("Mapped", (), {})),
        ("mapped_column", lambda *a, **kw: None),
        ("DeclarativeBase", object),
        ("sessionmaker", MagicMock()),
    ],
    "sqlalchemy.ext": [],
    "sqlalchemy.ext.asyncio": [
        ("AsyncEngine", type("AsyncEngine", (), {})),
        ("Engine", type("Engine", (), {})),
        ("AsyncSession", type("AsyncSession", (), {})),
        ("AsyncGenerator", type("AsyncGenerator", (), {})),
        ("async_sessionmaker", type("async_sessionmaker", (), {})),
        ("create_async_engine", MagicMock()),
        ("create_engine", MagicMock()),
    ],
    "sqlalchemy.pool": [
        ("NullPool", type("NullPool", (), {})),
    ],
}

for mod_name, attrs in _STUB_MODULES.items():
    if mod_name not in sys.modules:
        m = types.ModuleType(mod_name)
        sys.modules[mod_name] = m
    m = sys.modules[mod_name]
    for attr, default in attrs:
        if not hasattr(m, attr):
            setattr(m, attr, default)

from app.deployment import approval_gates as gates_module
from app.deployment.approval_gates import (
    ACTION_MIGRATE,
    ACTION_PROVISION,
    ACTION_REQUEST,
    STATUS_APPROVED,
    STATUS_PROVISIONED,
    STATUS_REQUESTED,
    STATUS_TERMINATED,
    ApprovalGate,
    ApprovalStateError,
    DoubleApprovalError,
)
from app.models.deployment import Server


class _StubServerFactory:
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
    def __init__(self, **kwargs):
        self.id = kwargs.get("id", "dep-uuid-001")
        self.status = kwargs.get("status", STATUS_REQUESTED)
        self.deployment_config = kwargs.get("deployment_config") or {}
        self.server_id = None
        self.approved_at = None
        self.provisioned_at = None
        self.terminated_at = None
        self.error_message = None


def _build_session(*, current_status: str, has_existing_approval: bool = False):
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


def test_approval_gates_module_exports_approval_service_alias():
    assert gates_module.ApprovalService is gates_module.ApprovalGate


def test_approval_state_error_carries_fields():
    err = ApprovalStateError("dep-1", "started", "requested")
    assert err.deployment_id == "dep-1"
    assert err.current_status == "started"
    assert err.expected == "requested"


def test_double_approval_error_carries_fields():
    err = DoubleApprovalError("dep-1", ACTION_PROVISION)
    assert err.deployment_id == "dep-1"
    assert err.action == ACTION_PROVISION


@pytest.mark.asyncio
async def test_approve_request_flips_status_and_stamps_approved_at():
    db, deployment = _build_session(current_status=STATUS_REQUESTED)
    gate = ApprovalGate(db=db, mode="mock")
    result = await gate.approve_request(
        deployment_id=deployment.id,
        approved_by="operator-1",
        notes="looks good",
    )
    assert result.status == STATUS_APPROVED
    assert deployment.status == STATUS_APPROVED
    assert deployment.approved_at is not None
    added = [c.args[0] for c in db.add.call_args_list]
    assert len(added) == 1
    assert added[0].action_type == ACTION_REQUEST
    assert added[0].approved_by == "operator-1"
    assert added[0].status == "approved"


@pytest.mark.asyncio
async def test_approve_request_rejects_wrong_state():
    db, deployment = _build_session(current_status=STATUS_APPROVED)
    gate = ApprovalGate(db=db, mode="mock")
    with pytest.raises(ApprovalStateError):
        await gate.approve_request(deployment_id=deployment.id, approved_by="op")


@pytest.mark.asyncio
async def test_approve_request_raises_when_deployment_missing():
    db, _ = _build_session(current_status=STATUS_REQUESTED)
    db.execute = AsyncMock(return_value=MagicMock(
        scalar_one_or_none=MagicMock(return_value=None),
    ))
    gate = ApprovalGate(db=db, mode="mock")
    with pytest.raises(LookupError):
        await gate.approve_request(deployment_id="nope", approved_by="op")


@pytest.mark.asyncio
async def test_approve_provision_calls_provider_and_attaches_server():
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

    original_registry = dict(gates_module.PROVIDER_REGISTRY)
    gates_module.PROVIDER_REGISTRY["mock"] = _StubServerFactory
    try:
        gate = ApprovalGate(db=db, mode="mock")
        result = await gate.approve_provision(
            deployment_id=deployment.id,
            approved_by="operator-1",
        )
    finally:
        gates_module.PROVIDER_REGISTRY.clear()
        gates_module.PROVIDER_REGISTRY.update(original_registry)

    assert result.status == STATUS_PROVISIONED
    assert deployment.status == STATUS_PROVISIONED
    assert deployment.provisioned_at is not None
    assert deployment.server_id is not None
    added = [c.args[0] for c in db.add.call_args_list]
    assert len(added) == 2
    action_types = [getattr(a, "action_type", None) for a in added]
    assert ACTION_PROVISION in action_types


@pytest.mark.asyncio
async def test_approve_provision_rejects_non_approved_state():
    db, deployment = _build_session(current_status=STATUS_REQUESTED)
    gate = ApprovalGate(db=db, mode="mock")
    with pytest.raises(ApprovalStateError):
        await gate.approve_provision(deployment_id=deployment.id, approved_by="op")


@pytest.mark.asyncio
async def test_approve_migrate_flips_to_terminated_with_error_message():
    db, deployment = _build_session(current_status=STATUS_PROVISIONED)
    gate = ApprovalGate(db=db, mode="mock")
    result = await gate.approve_migrate(
        deployment_id=deployment.id,
        approved_by="operator-1",
        notes="rolling ROI negative",
    )
    assert result.status == STATUS_TERMINATED
    assert deployment.status == STATUS_TERMINATED
    assert deployment.terminated_at is not None
    assert deployment.error_message == "migrated by operator"
    added = [c.args[0] for c in db.add.call_args_list]
    assert len(added) == 1
    assert added[0].action_type == ACTION_MIGRATE


@pytest.mark.asyncio
async def test_approve_migrate_accepts_started_state():
    db, deployment = _build_session(current_status="started")
    gate = ApprovalGate(db=db, mode="mock")
    result = await gate.approve_migrate(
        deployment_id=deployment.id,
        approved_by="operator-1",
        notes="switch subnet",
    )
    assert result.status == STATUS_TERMINATED
    assert deployment.terminated_at is not None


@pytest.mark.asyncio
async def test_approve_migrate_rejects_wrong_state():
    db, deployment = _build_session(current_status=STATUS_REQUESTED)
    gate = ApprovalGate(db=db, mode="mock")
    with pytest.raises(ApprovalStateError):
        await gate.approve_migrate(deployment_id=deployment.id, approved_by="op")


@pytest.mark.asyncio
async def test_double_approval_raises_guard_rail():
    db, deployment = _build_session(
        current_status=STATUS_APPROVED,
        has_existing_approval=True,
    )
    gate = ApprovalGate(db=db, mode="mock")
    with pytest.raises(DoubleApprovalError):
        await gate.approve_provision(
            deployment_id=deployment.id,
            approved_by="operator-2",
        )
    assert deployment.status == STATUS_APPROVED
    assert deployment.provisioned_at is None
    db.commit.assert_not_called()
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_double_approval_guard_fires_before_mutation():
    db, deployment = _build_session(
        current_status=STATUS_REQUESTED,
        has_existing_approval=True,
    )
    gate = ApprovalGate(db=db, mode="mock")
    with pytest.raises(DoubleApprovalError):
        await gate.approve_request(
            deployment_id=deployment.id,
            approved_by="operator-2",
        )
    assert deployment.status == STATUS_REQUESTED
    assert deployment.approved_at is None
