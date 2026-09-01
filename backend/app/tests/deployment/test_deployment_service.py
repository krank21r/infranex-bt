"""
Tests for DeploymentService lifecycle (Phase 7+).

The SQLAlchemy/greenlet stack is incompatible with the Python 3.15
beta installed in this environment. To keep tests runnable we inject
light module stubs before importing the app package.
"""
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

from app.deployment.state_machine import DeploymentState
from app.providers import PROVIDER_REGISTRY, MockProvider
from app.services.deployment_service import (
    DEFAULT_DEPLOYMENT_MODE,
    CostProjection,
    DeploymentService,
)


def _make_db() -> AsyncMock:
    """Create an AsyncMock db that stores/retrieves Deployment objects."""
    store: dict[str, Any] = {}

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
        "gpu_count": 1,
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


def test_cost_projection_monthly_is_hourly_times_730():
    c = CostProjection(hourly_price=1.5, currency="USD")
    assert c.monthly == 1095.0


def test_provider_registry_defaults_to_mock():
    assert "mock" in PROVIDER_REGISTRY
    assert PROVIDER_REGISTRY["mock"] is MockProvider
    assert DEFAULT_DEPLOYMENT_MODE == "mock"


@pytest.mark.asyncio
async def test_request_deployment_returns_requested_row_with_cost_fields():
    svc = DeploymentService(db=_make_db(), mode="mock")
    offer = _offer(hourly_price=2.0, currency="USD", gpu_model_name="A100")
    requirements = _requirements(min_vram_gb=24.0, recommended_gpu="A100")

    deployment = await svc.request_deployment(
        netuid=7, offer=offer, requirements=requirements, hotkey_address="5GrwvaEF..."
    )

    assert deployment.status == "requested"
    assert deployment.estimated_monthly_cost == 2.0 * 730
    assert deployment.currency == "USD"
    assert deployment.netuid == 7
    assert deployment.hotkey_address == "5GrwvaEF..."
    assert deployment.deployment_config is not None
    assert deployment.deployment_config["offer"]["gpu_model_name"] == "A100"
    assert deployment.deployment_config["requirements"]["min_vram_gb"] == 24.0


@pytest.mark.asyncio
async def test_approve_deployment_transitions_to_approved():
    svc = DeploymentService(db=_make_db(), mode="mock")
    offer = _offer()
    requirements = _requirements()
    deployment = await svc.request_deployment(netuid=7, offer=offer, requirements=requirements)
    deployment.status = DeploymentState.REQUESTED.value

    approved = await svc.approve_deployment(deployment.id)

    assert approved.status == DeploymentState.APPROVED.value
    assert approved.approved_at is not None


@pytest.mark.asyncio
async def test_approve_deployment_rejects_non_requested():
    svc = DeploymentService(db=_make_db(), mode="mock")
    deployment = await svc.request_deployment(netuid=7, offer=_offer(), requirements=_requirements())
    deployment.status = DeploymentState.APPROVED.value

    with pytest.raises(ValueError, match="Cannot approve"):
        await svc.approve_deployment(deployment.id)


@pytest.mark.asyncio
async def test_provision_server_transitions_to_provisioned():
    svc = DeploymentService(db=_make_db(), mode="mock")
    offer = _offer()
    requirements = _requirements()
    deployment = await svc.request_deployment(netuid=7, offer=offer, requirements=requirements)
    deployment.status = DeploymentState.APPROVED.value

    provisioned = await svc.provision_server(deployment.id, offer)

    assert provisioned.status == DeploymentState.PROVISIONED.value
    assert provisioned.server_id is not None
    assert provisioned.provisioned_at is not None


@pytest.mark.asyncio
async def test_setup_server_validates_compatibility():
    svc = DeploymentService(db=_make_db(), mode="mock")
    offer = _offer()
    requirements = _requirements()
    deployment = await svc.request_deployment(netuid=7, offer=offer, requirements=requirements)
    deployment.status = DeploymentState.PROVISIONED.value
    deployment.deployment_config = {"requirements": requirements}
    mock_server = MagicMock()
    mock_server.id = "srv-1"
    mock_server.provider_instance_id = "mock-srv-0001"
    mock_server.gpu_model = "NVIDIA A100"
    mock_server.vram_gb = 80.0
    mock_server.extra_metadata = {}
    svc.db.execute = AsyncMock(return_value=MagicMock(
        scalar_one_or_none=MagicMock(return_value=mock_server),
    ))

    ready = await svc.setup_server(deployment.id)

    assert ready.status == DeploymentState.READY.value


@pytest.mark.asyncio
async def test_deploy_miner_transitions_to_started():
    svc = DeploymentService(db=_make_db(), mode="mock")
    offer = _offer()
    requirements = _requirements()
    deployment = await svc.request_deployment(netuid=7, offer=offer, requirements=requirements)
    deployment.status = DeploymentState.READY.value
    mock_server = MagicMock()
    mock_server.id = "srv-1"
    mock_server.status = None
    svc.db.execute = AsyncMock(return_value=MagicMock(
        scalar_one_or_none=MagicMock(return_value=mock_server),
    ))

    started = await svc.deploy_miner(deployment.id)

    assert started.status == DeploymentState.STARTED.value
    assert started.started_at is not None


@pytest.mark.asyncio
async def test_stop_miner_transitions_to_stopped():
    svc = DeploymentService(db=_make_db(), mode="mock")
    offer = _offer()
    requirements = _requirements()
    deployment = await svc.request_deployment(netuid=7, offer=offer, requirements=requirements)
    deployment.status = DeploymentState.STARTED.value
    mock_server = MagicMock()
    mock_server.id = "srv-1"
    mock_server.status = None
    svc.db.execute = AsyncMock(return_value=MagicMock(
        scalar_one_or_none=MagicMock(return_value=mock_server),
    ))

    stopped = await svc.stop_miner(deployment.id)

    assert stopped.status == DeploymentState.STOPPED.value
    assert stopped.stopped_at is not None


@pytest.mark.asyncio
async def test_terminate_deployment_transitions_to_terminated():
    svc = DeploymentService(db=_make_db(), mode="mock")
    offer = _offer()
    requirements = _requirements()
    deployment = await svc.request_deployment(netuid=7, offer=offer, requirements=requirements)
    deployment.status = DeploymentState.STOPPED.value
    mock_server = MagicMock()
    mock_server.id = "srv-1"
    mock_server.status = None
    mock_server.terminated_at = None
    svc.db.execute = AsyncMock(return_value=MagicMock(
        scalar_one_or_none=MagicMock(return_value=mock_server),
    ))

    terminated = await svc.terminate_deployment(deployment.id, reason="operator request")

    assert terminated.status == DeploymentState.TERMINATED.value
    assert terminated.terminated_at is not None
