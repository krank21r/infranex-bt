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

from app.deployment.deployer import (
    DEFAULT_DEPLOYMENT_MODE,
    VALID_MODES,
    CostProjection,
    Deployer,
    build_deployment_config,
    fetch_deployment,
    transition,
)
from app.deployment.state_machine import DeploymentState


def _make_db() -> AsyncMock:
    store: dict[str, object] = {}

    db = AsyncMock()

    def _add(obj):
        pk = getattr(obj, "id", None)
        if pk is None:
            pk = f"mock-{len(store)+1:04d}"
            obj.id = pk
        store[pk] = obj

    async def _get(model, pk):
        return store.get(pk)

    async def _flush():
        pass

    db.add = _add
    db.get = _get
    db.flush = _flush
    db.execute = AsyncMock(return_value=MagicMock(
        scalar_one_or_none=MagicMock(return_value=None),
        scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[]))),
    ))
    return db


def _offer(**overrides) -> dict:
    d = {
        "id": "of-1",
        "provider_id": "prov-1",
        "gpu_model_id": "gpu-A100",
        "gpu_model_name": "A100",
        "region": "US",
        "vram_gb": 80.0,
        "ram_gb": 256.0,
        "storage_gb": 1000.0,
        "instance_type": "A100-instance",
        "is_spot": False,
        "hourly_price": 1.5,
        "currency": "USD",
    }
    d.update(overrides)
    return d


def _requirements(**overrides) -> dict:
    d = {
        "min_vram_gb": 24.0,
        "recommended_gpu": "A100",
        "python_version": "3.10",
        "docker_required": True,
        "nvidia_runtime_required": True,
        "ports": [8091, 8092],
        "startup_command": "python -m miner.start",
        "miner_command": "python -m miner.run",
    }
    d.update(overrides)
    return d


def test_deployer_module_exports_deployment_service_alias():
    from app.deployment import deployer
    assert deployer.DeploymentService is deployer.Deployer


def test_cost_projection_monthly():
    c = CostProjection(hourly_price=1.5, currency="USD")
    assert c.monthly == 1095.0


def test_default_deployment_mode_is_mock():
    assert DEFAULT_DEPLOYMENT_MODE == "mock"
    assert "mock" in VALID_MODES


def test_build_deployment_config_snapshots_offer_and_requirements():
    config = build_deployment_config(_offer(), _requirements())
    assert config["offer"]["gpu_model_name"] == "A100"
    assert config["offer"]["region"] == "US"
    assert config["offer"]["id"] == "of-1"
    assert config["requirements"]["min_vram_gb"] == 24.0


@pytest.mark.asyncio
async def test_fetch_deployment_raises_when_missing():
    db = MagicMock()
    db.get = AsyncMock(return_value=None)
    with pytest.raises(ValueError, match="not found"):
        await fetch_deployment(db, "missing-id")


@pytest.mark.asyncio
async def test_deployer_request_creates_requested_row():
    svc = Deployer(db=_make_db(), mode="mock")
    deployment = await svc.request_deployment(
        netuid=7, offer=_offer(hourly_price=2.0), requirements=_requirements()
    )
    assert deployment.status == "requested"
    assert deployment.estimated_monthly_cost == 2.0 * 730
    assert deployment.currency == "USD"
    assert deployment.netuid == 7


@pytest.mark.asyncio
async def test_deployer_provision_requires_approved_state():
    svc = Deployer(db=_make_db(), mode="mock")
    deployment = await svc.request_deployment(netuid=7, offer=_offer(), requirements=_requirements())
    deployment.status = DeploymentState.PROVISIONING.value
    with pytest.raises(ValueError, match="Cannot provision"):
        await svc.provision_server(deployment.id, _offer())


@pytest.mark.asyncio
async def test_deployer_stop_miner_requires_started_state():
    svc = Deployer(db=_make_db(), mode="mock")
    deployment = await svc.request_deployment(netuid=7, offer=_offer(), requirements=_requirements())
    deployment.status = DeploymentState.READY.value
    with pytest.raises(ValueError, match="Cannot stop miner"):
        await svc.stop_miner(deployment.id)


@pytest.mark.asyncio
async def test_deployer_terminate_force_from_any_state():
    svc = Deployer(db=_make_db(), mode="mock")
    deployment = await svc.request_deployment(netuid=7, offer=_offer(), requirements=_requirements())
    deployment.status = DeploymentState.READY.value
    terminated = await svc.terminate_deployment(deployment.id, reason="manual", force=True)
    assert terminated.status == DeploymentState.TERMINATED.value
    assert terminated.terminated_at is not None


@pytest.mark.asyncio
async def test_transition_uses_state_machine_guards():
    db = _make_db()
    deployment = MagicMock()
    deployment.status = "started"
    deployment.error_message = None
    with pytest.raises(ValueError, match="Invalid transition"):
        await transition(db, deployment, "requested")
