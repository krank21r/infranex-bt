"""
Tests for DeploymentService (Phase 7).

Pins the request-side contract only — the user explicitly chose
"Ship 1 test, request only" for the min-viable scope.

Asserted invariants:
  - status starts at 'requested' (no provider call yet).
  - estimated_monthly_cost = hourly_price * 730, rounded.
  - currency is preserved from the offer.
  - deployment_config is a populated JSONB-shaped dict (offer +
    requirements snapshot, not None).
  - netuid is threaded onto the row.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.services.deployment_service import (
    DeploymentService,
    CostProjection,
    MockProvider,
    ProductionProvider,
    PROVIDER_REGISTRY,
    DEFAULT_DEPLOYMENT_MODE,
)


# ---------- helpers ----------


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


# ---------- cost projection helper ----------


def test_cost_projection_monthly_is_hourly_times_730():
    """Sanity check on the cost helper. Not a service test, but pins the math."""
    c = CostProjection(hourly_price=1.5, currency="USD")
    assert c.monthly == 1095.0  # 1.5 * 730


# ---------- provider registry ----------


def test_provider_registry_defaults_to_mock():
    """Default mode is mock; registry contains both adapters."""
    assert "mock" in PROVIDER_REGISTRY
    assert "production" in PROVIDER_REGISTRY
    assert PROVIDER_REGISTRY["mock"] is MockProvider
    assert PROVIDER_REGISTRY["production"] is ProductionProvider
    assert DEFAULT_DEPLOYMENT_MODE == "mock"


# ---------- request_deployment happy path ----------


@pytest.mark.asyncio
async def test_request_deployment_returns_requested_row_with_cost_fields():
    """Service: request_deployment creates a Deployment in 'requested' state.

    Verifies:
      - status == 'requested' (no provider side-effect yet).
      - estimated_monthly_cost == hourly_price * 730.
      - currency is preserved from the offer.
      - deployment_config is populated with offer + requirements snapshot.
      - netuid is threaded onto the row.
    """
    svc = DeploymentService(db=AsyncMock(), mode="mock")

    offer = _offer(hourly_price=2.0, currency="USD", gpu_model_name="A100")
    requirements = _requirements(min_vram_gb=24.0, recommended_gpu="A100")

    deployment = await svc.request_deployment(
        netuid=7,
        offer=offer,
        requirements=requirements,
        hotkey_address="5GrwvaEF...",
    )

    # Status + cost projection
    assert deployment.status == "requested"
    assert deployment.estimated_monthly_cost == 2.0 * 730
    assert deployment.currency == "USD"

    # Identity
    assert deployment.netuid == 7
    assert deployment.hotkey_address == "5GrwvaEF..."

    # Config snapshot — both halves populated, not None.
    assert deployment.deployment_config is not None
    assert "offer" in deployment.deployment_config
    assert "requirements" in deployment.deployment_config
    assert deployment.deployment_config["offer"]["gpu_model_name"] == "A100"
    assert deployment.deployment_config["offer"]["region"] == "US"
    assert deployment.deployment_config["requirements"]["min_vram_gb"] == 24.0
    assert deployment.deployment_config["requirements"]["recommended_gpu"] == "A100"
