"""
Tests for recovery strategy execution with provider integration.

Uses lightweight fakes and patches to pin contracts without requiring
a full SQLAlchemy setup.
"""
from __future__ import annotations

import sys
import types
from typing import Any

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

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

from app.recovery.strategies import (
    RecoveryResult,
    restart_process,
    redeploy,
    switch_subnet,
    escalate_to_human,
)
from app.recovery.recovery import RecoveryEngine, RecoveryAction, RECOVERY_MODEL_VERSION


# ---------- helpers ----------


class FakeDB:
    """Minimal async fake DB that stores objects by id."""

    def __init__(self) -> None:
        self.store: dict[str, Any] = {}
        self.execute_results: list[Any] = []

    async def get(self, model: Any, pk: str) -> Any:
        return self.store.get(pk)

    def add(self, obj: Any) -> None:
        pk = getattr(obj, "id", None)
        if pk is None:
            pk = f"mock-{len(self.store)+1:04d}"
            setattr(obj, "id", pk)
        self.store[pk] = obj

    async def flush(self) -> None:
        pass

    async def commit(self) -> None:
        pass

    async def execute(self, stmt: Any) -> MagicMock:
        if self.execute_results:
            return self.execute_results.pop(0)
        return MagicMock(
            scalar_one_or_none=MagicMock(return_value=None),
            scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[]))),
        )


def _make_db() -> FakeDB:
    return FakeDB()


def _deployment(**overrides) -> MagicMock:
    d = MagicMock()
    d.id = "dep-1"
    d.server_id = "srv-1"
    d.netuid = 1
    d.deployment_config = {"offer": {"gpu_model_name": "A100"}}
    for k, v in overrides.items():
        setattr(d, k, v)
    return d


def _server(**overrides) -> MagicMock:
    s = MagicMock()
    s.id = "srv-1"
    s.provider_instance_id = "mock-srv-0001"
    s.status = "running"
    for k, v in overrides.items():
        setattr(s, k, v)
    return s


def _new_server(**overrides) -> MagicMock:
    s = MagicMock()
    s.id = "srv-2"
    s.provider_instance_id = "mock-srv-0002"
    s.status = "provisioning"
    for k, v in overrides.items():
        setattr(s, k, v)
    return s


def _miner(**overrides) -> MagicMock:
    m = MagicMock()
    m.id = "m-1"
    m.deployment_id = "dep-1"
    m.netuid = 1
    for k, v in overrides.items():
        setattr(m, k, v)
    return m


# ---------- restart_process tests ----------


class TestRestartProcess:
    @pytest.mark.asyncio
    async def test_stops_miner_and_provisions_new_server(self):
        db = _make_db()
        deployment = _deployment()
        server = _server()
        new_srv = _new_server()

        db.store["dep-1"] = deployment
        db.store["srv-1"] = server

        provider = MagicMock()
        provider.stop_miner = AsyncMock(return_value=True)
        provider.provision_server = AsyncMock(return_value=new_srv)

        with patch("app.recovery.strategies.get_provider", return_value=provider), patch(
            "app.recovery.strategies._audit_log"
        ) as mock_audit:
            result = await restart_process(db, {
                "miner_id": "m-1",
                "params": {"deployment_id": "dep-1", "process_id": 42},
                "reason": "health check failed",
            })

        assert result.success is True
        assert result.action_type == "restart_miner"
        assert result.action_level == "L2_confirm"
        assert "m-1" in result.message
        provider.stop_miner.assert_called_once_with(server)
        provider.provision_server.assert_called_once_with(deployment)
        assert db.store["srv-2"] == new_srv
        mock_audit.assert_called_once()

    @pytest.mark.asyncio
    async def test_returns_failure_when_deployment_not_found(self):
        db = _make_db()

        with patch("app.recovery.strategies._audit_log"):
            result = await restart_process(db, {
                "miner_id": "m-1",
                "params": {"deployment_id": "missing"},
            })

        assert result.success is False
        assert "not found" in result.message
        assert result.action_type == "restart_miner"

    @pytest.mark.asyncio
    async def test_provisions_new_server_when_no_existing_server(self):
        db = _make_db()
        deployment = _deployment(server_id=None)
        new_srv = _new_server()

        db.store["dep-1"] = deployment

        provider = MagicMock()
        provider.provision_server = AsyncMock(return_value=new_srv)

        with patch("app.recovery.strategies.get_provider", return_value=provider), patch(
            "app.recovery.strategies._audit_log"
        ):
            result = await restart_process(db, {
                "miner_id": "m-1",
                "params": {"deployment_id": "dep-1"},
            })

        assert result.success is True
        provider.stop_miner.assert_not_called()
        provider.provision_server.assert_called_once_with(deployment)


# ---------- redeploy tests ----------


class TestRedeploy:
    @pytest.mark.asyncio
    async def test_delegates_to_deployment_service(self):
        db = _make_db()
        deployment = _deployment()
        updated = _deployment(status="started", server_id="srv-3")

        db.store["dep-1"] = deployment

        deployment_service = MagicMock()
        deployment_service.redeploy_miner = AsyncMock(return_value=updated)

        with patch("app.recovery.strategies.DeploymentService", return_value=deployment_service), patch(
            "app.recovery.strategies._audit_log"
        ):
            result = await redeploy(db, {
                "miner_id": "m-1",
                "params": {"deployment_id": "dep-1", "is_new_deployment": False},
                "reason": "container crashed",
            })

        assert result.success is True
        assert result.action_type == "recover_container"
        assert result.action_level == "L2_confirm"
        deployment_service.redeploy_miner.assert_called_once_with("dep-1")

    @pytest.mark.asyncio
    async def test_returns_failure_when_deployment_not_found(self):
        db = _make_db()

        with patch("app.recovery.strategies._audit_log"):
            result = await redeploy(db, {
                "miner_id": "m-1",
                "params": {"deployment_id": "missing"},
            })

        assert result.success is False
        assert "not found" in result.message
        assert result.action_type == "recover_container"

    @pytest.mark.asyncio
    async def test_returns_failure_on_service_exception(self):
        db = _make_db()
        deployment = _deployment()

        db.store["dep-1"] = deployment

        deployment_service = MagicMock()
        deployment_service.redeploy_miner.side_effect = RuntimeError("provider down")

        with patch("app.recovery.strategies.DeploymentService", return_value=deployment_service), patch(
            "app.recovery.strategies._audit_log"
        ):
            result = await redeploy(db, {
                "miner_id": "m-1",
                "params": {"deployment_id": "dep-1"},
            })

        assert result.success is False
        assert "Redeploy failed" in result.message


# ---------- switch_subnet tests ----------


class TestSwitchSubnet:
    @pytest.mark.asyncio
    async def test_updates_miner_netuid_and_reprovisions(self):
        db = _make_db()
        miner = _miner(netuid=1)
        deployment = _deployment(netuid=1)
        server = _server()
        new_srv = _new_server()

        db.store["m-1"] = miner
        db.store["dep-1"] = deployment
        db.store["srv-1"] = server

        provider = MagicMock()
        provider.stop_miner = AsyncMock(return_value=True)
        provider.provision_server = AsyncMock(return_value=new_srv)

        with patch("app.recovery.strategies.get_provider", return_value=provider), patch(
            "app.recovery.strategies._audit_log"
        ):
            result = await switch_subnet(db, {
                "miner_id": "m-1",
                "params": {"target_netuid": 5, "is_new_subnet": False},
                "reason": "better roi",
            })

        assert result.success is True
        assert result.action_type == "switch_subnet_within_roi_band"
        assert result.action_level == "L2_confirm"
        assert miner.netuid == 5
        assert deployment.netuid == 5
        provider.stop_miner.assert_called_once_with(server)
        provider.provision_server.assert_called_once_with(deployment)
        assert db.store["srv-2"] == new_srv
        deployment.server_id = new_srv.id

    @pytest.mark.asyncio
    async def test_returns_failure_when_miner_not_found(self):
        db = _make_db()

        with patch("app.recovery.strategies._audit_log"):
            result = await switch_subnet(db, {
                "miner_id": "missing",
                "params": {"target_netuid": 5},
            })

        assert result.success is False
        assert "not found" in result.message
        assert result.action_type == "switch_subnet_within_roi_band"

    @pytest.mark.asyncio
    async def test_new_subnet_is_l3(self):
        db = _make_db()
        miner = _miner(netuid=1)
        deployment = _deployment(netuid=1)

        db.store["m-1"] = miner
        db.store["dep-1"] = deployment

        with patch("app.recovery.strategies._audit_log"):
            result = await switch_subnet(db, {
                "miner_id": "m-1",
                "params": {"target_netuid": 5, "is_new_subnet": True},
            })

        assert result.success is True
        assert result.action_type == "migrate_to_new_subnet"
        assert result.action_level == "L3_mandatory"


# ---------- escalate_to_human tests ----------


class TestEscalateToHuman:
    @pytest.mark.asyncio
    async def test_creates_approval_request_and_logs(self):
        db = _make_db()

        approval_id = "approval-123"
        svc = MagicMock()
        svc.create = AsyncMock(return_value=approval_id)

        with patch("app.recovery.strategies.ApprovalService", return_value=svc), patch(
            "app.recovery.strategies._audit_log"
        ) as mock_audit:
            result = await escalate_to_human(db, {
                "miner_id": "m-1",
                "reason": "unknown failure",
                "params": {"risk_score": 0.9},
            })

        assert result.success is True
        assert result.action_type == "escalate_to_human"
        assert result.action_level == "L3_mandatory"
        assert result.details["approval_id"] == approval_id
        svc.create.assert_called_once()
        mock_audit.assert_called_once()


# ---------- execute_with_approval tests ----------


class TestExecuteWithApproval:
    @pytest.mark.asyncio
    async def test_l1_auto_executes_without_approval(self):
        db = _make_db()
        engine = RecoveryEngine(db=db)

        action = RecoveryAction(
            action_type="restart_process",
            miner_id="m-1",
            reason="test",
            action_level="L1_auto",
            params={"deployment_id": "dep-1", "process_id": 42},
        )

        deployment = _deployment()
        server = _server()
        new_srv = _new_server()

        db.store["dep-1"] = deployment
        db.store["srv-1"] = server

        provider = MagicMock()
        provider.stop_miner = AsyncMock(return_value=True)
        provider.provision_server = AsyncMock(return_value=new_srv)

        with patch("app.recovery.strategies.get_provider", return_value=provider), patch(
            "app.recovery.strategies._audit_log"
        ):
            result = await engine.execute_with_approval(action)

        assert result.success is True

    @pytest.mark.asyncio
    async def test_l2_returns_pending_without_approval(self):
        db = _make_db()
        engine = RecoveryEngine(db=db)

        action = RecoveryAction(
            action_type="restart_process",
            miner_id="m-1",
            reason="test",
            action_level="L2_confirm",
            params={"deployment_id": "dep-1"},
        )

        approval_request = MagicMock()
        approval_request.id = "approval-1"
        approval_request.status = "pending"

        db.execute_results = [
            MagicMock(scalar_one_or_none=MagicMock(return_value=approval_request)),
        ]

        result = await engine.execute_with_approval(action, approval_id="approval-1")

        assert result.success is False
        assert "pending" in result.message
        assert result.details["approval_status"] == "pending"

    @pytest.mark.asyncio
    async def test_l3_executes_when_approved(self):
        db = _make_db()
        engine = RecoveryEngine(db=db)

        action = RecoveryAction(
            action_type="switch_subnet",
            miner_id="m-1",
            reason="test",
            action_level="L3_mandatory",
            params={"target_netuid": 5, "is_new_subnet": True},
        )

        approval_request = MagicMock()
        approval_request.id = "approval-1"
        approval_request.status = "approved"

        db.execute_results = [
            MagicMock(scalar_one_or_none=MagicMock(return_value=approval_request)),
        ]

        miner = _miner()
        deployment = _deployment()

        db.store["m-1"] = miner
        db.store["dep-1"] = deployment

        provider = MagicMock()
        provider.stop_miner = AsyncMock(return_value=True)
        provider.provision_server = AsyncMock(return_value=_new_server())

        with patch("app.recovery.strategies.get_provider", return_value=provider), patch(
            "app.recovery.strategies._audit_log"
        ):
            result = await engine.execute_with_approval(action, approval_id="approval-1")

        assert result.success is True
        assert result.action_type == "migrate_to_new_subnet"

    @pytest.mark.asyncio
    async def test_creates_approval_when_id_missing(self):
        db = _make_db()
        engine = RecoveryEngine(db=db)

        action = RecoveryAction(
            action_type="restart_process",
            miner_id="m-1",
            reason="test",
            action_level="L2_confirm",
            params={"deployment_id": "dep-1"},
        )

        approval_request = MagicMock()
        approval_request.id = "approval-new"
        approval_request.status = "pending"

        db.execute_results = [
            MagicMock(scalar_one_or_none=MagicMock(return_value=approval_request)),
        ]

        with patch("app.recovery.recovery.request_approval", return_value=("approval-new", approval_request)):
            result = await engine.execute_with_approval(action)

        assert result.success is False
        assert "pending" in result.message


# ---------- model version pin ----------


def test_recovery_model_version_is_v1():
    assert RECOVERY_MODEL_VERSION == "v1.0"
