"""
Tests for deployment health checker.

The SQLAlchemy/greenlet stack is incompatible with the Python 3.15
beta installed in this environment. To keep tests runnable we inject
light module stubs before importing the app package.
"""
from __future__ import annotations

import sys
import types
import pytest
from unittest.mock import AsyncMock, MagicMock
from datetime import datetime, timezone

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
        ("async_sessionmaker", type("async_sessionmaker", (), {})),
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

from app.deployment.health_check import HealthChecker, HealthCheckResult
from app.deployment.state_machine import DeploymentState


def _make_db(rows: list) -> AsyncMock:
    db = AsyncMock()
    stmt_result = MagicMock()
    stmt_result.all = MagicMock(return_value=rows)
    db.execute = AsyncMock(return_value=stmt_result)
    return db


def _deployment(status: str = DeploymentState.STARTED.value, netuid: int = 7) -> MagicMock:
    d = MagicMock()
    d.id = "dep-1"
    d.netuid = netuid
    d.status = status
    d.created_at = datetime.now(timezone.utc)
    d.updated_at = datetime.now(timezone.utc)
    return d


def _server(status: str = "running", ip: str = "10.0.0.1", ssh_port: int = 22) -> MagicMock:
    s = MagicMock()
    s.id = "srv-1"
    s.deployment_id = "dep-1"
    s.status = status
    s.ip_address = ip
    s.ssh_port = ssh_port
    s.gpu_model = "NVIDIA A100"
    s.created_at = datetime.now(timezone.utc)
    s.updated_at = datetime.now(timezone.utc)
    return s


@pytest.mark.asyncio
async def test_run_once_returns_results_for_started_deployments():
    db = _make_db([(_deployment(), _server())])

    checker = HealthChecker(db)
    results = await checker.run_once()

    assert len(results) == 1
    assert results[0].deployment_id == "dep-1"
    assert results[0].healthy is True
    assert results[0].miner_running is True
    assert results[0].subnet_connected is True


@pytest.mark.asyncio
async def test_run_once_skips_non_started_deployments():
    db = _make_db([])

    checker = HealthChecker(db)
    results = await checker.run_once()

    assert len(results) == 0


def test_health_check_result_defaults_details():
    now = datetime.now(timezone.utc)
    result = HealthCheckResult(
        deployment_id="dep-1",
        server_id="srv-1",
        healthy=False,
        miner_running=False,
        subnet_connected=False,
        checked_at=now,
        error="timeout",
    )
    assert result.details == {}
