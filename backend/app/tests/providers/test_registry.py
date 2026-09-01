"""
Tests for the provider registry.

Pins:
  - every named provider is registered and instantiable.
  - `get_provider` falls back to mock for unknown modes.
  - `production` remains a guarded stub (raises NotImplementedError).
  - The deployment_service re-exports the same registry objects so the
    existing service-layer contract is preserved.
"""
import pytest

from app.providers import (
    PROVIDER_REGISTRY,
    E2EProvider,
    MockProvider,
    ProductionProvider,
    RunPodProvider,
    TensorDockProvider,
    VastAIProvider,
    get_provider,
)
from app.providers.base import GPUProvider
from app.services.deployment_service import (
    DEFAULT_DEPLOYMENT_MODE,
)
from app.services.deployment_service import (
    PROVIDER_REGISTRY as SERVICE_REGISTRY,
)


def test_registry_contains_all_adapters():
    assert PROVIDER_REGISTRY["mock"] is MockProvider
    assert PROVIDER_REGISTRY["production"] is ProductionProvider
    assert PROVIDER_REGISTRY["runpod"] is RunPodProvider
    assert PROVIDER_REGISTRY["vastai"] is VastAIProvider
    assert PROVIDER_REGISTRY["tensordock"] is TensorDockProvider
    assert PROVIDER_REGISTRY["e2e"] is E2EProvider


def test_registry_is_shared_with_deployment_service():
    # The service module must surface the exact same registry object so
    # runtime provider resolution is consistent across services.
    assert SERVICE_REGISTRY is PROVIDER_REGISTRY
    assert DEFAULT_DEPLOYMENT_MODE == "mock"


def test_get_provider_defaults_to_mock():
    provider = get_provider()
    assert isinstance(provider, MockProvider)


def test_get_provider_unknown_falls_back_to_mock():
    provider = get_provider("not-a-real-provider")
    assert isinstance(provider, MockProvider)


@pytest.mark.asyncio
async def test_production_provider_raises_not_implemented():
    provider = get_provider("production")
    assert isinstance(provider, ProductionProvider)
    from app.models.deployment import Server

    with pytest.raises(NotImplementedError):
        await provider.provision_server(None)
    with pytest.raises(NotImplementedError):
        provider.terminate_server(Server(provider_instance_id="x"))


def test_real_adapters_are_structurally_gpu_providers():
    # runtime_checkable Protocol supports isinstance structural checks.
    for cls in (MockProvider, RunPodProvider, VastAIProvider, TensorDockProvider, E2EProvider):
        assert isinstance(cls(), GPUProvider)
