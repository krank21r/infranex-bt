"""
Tests for provider contract — offer_from_deployment, deploy_miner,
setup_server, get_status, and parameterized lifecycle across all providers.

Fills gaps in existing provider test coverage.
"""
from types import SimpleNamespace

import pytest

from app.models.deployment import Server
from app.providers.base import GPUProvider, offer_from_deployment
from app.providers.e2e import E2EProvider
from app.providers.mock import MockProvider
from app.providers.registry import PROVIDER_REGISTRY
from app.providers.runpod import RunPodProvider
from app.providers.tensordock import TensorDockProvider
from app.providers.vastai import VastAIProvider
from app.tests.providers._support import fake_deployment

# ---------- offer_from_deployment ----------


class TestOfferFromDeployment:
    def test_extracts_offer_from_config(self):
        deployment = SimpleNamespace(
            deployment_config={"offer": {"id": "of-1", "gpu_model_name": "A100"}}
        )
        result = offer_from_deployment(deployment)
        assert result == {"id": "of-1", "gpu_model_name": "A100"}

    def test_missing_config_returns_empty(self):
        deployment = SimpleNamespace()
        result = offer_from_deployment(deployment)
        assert result == {}

    def test_none_config_returns_empty(self):
        deployment = SimpleNamespace(deployment_config=None)
        result = offer_from_deployment(deployment)
        assert result == {}

    def test_missing_offer_key_returns_empty(self):
        deployment = SimpleNamespace(deployment_config={"other": "data"})
        result = offer_from_deployment(deployment)
        assert result == {}

    def test_none_offer_returns_empty(self):
        deployment = SimpleNamespace(deployment_config={"offer": None})
        result = offer_from_deployment(deployment)
        assert result == {}

    def test_empty_offer_returns_empty(self):
        deployment = SimpleNamespace(deployment_config={"offer": {}})
        result = offer_from_deployment(deployment)
        assert result == {}


# ---------- provider attribute validation ----------


class TestProviderAttributes:
    @pytest.mark.parametrize("name,cls", list(PROVIDER_REGISTRY.items()))
    def test_provider_has_name_attribute(self, name, cls):
        instance = cls()
        assert hasattr(instance, "name")
        assert isinstance(instance.name, str)
        assert len(instance.name) > 0

    @pytest.mark.parametrize("name,cls", list(PROVIDER_REGISTRY.items()))
    def test_provider_satisfies_protocol(self, name, cls):
        instance = cls()
        assert isinstance(instance, GPUProvider)

    @pytest.mark.parametrize("name,cls", list(PROVIDER_REGISTRY.items()))
    def test_provider_has_all_methods(self, name, cls):
        instance = cls()
        assert hasattr(instance, "provision_server")
        assert hasattr(instance, "setup_server")
        assert hasattr(instance, "deploy_miner")
        assert hasattr(instance, "stop_miner")
        assert hasattr(instance, "terminate_server")
        assert hasattr(instance, "get_status")


# ---------- deploy_miner tests ----------


class TestDeployMiner:
    @pytest.mark.asyncio
    async def test_mock_deploy_miner_sets_started(self):
        provider = MockProvider()
        server = await provider.provision_server(fake_deployment({
            "id": "of-1", "provider_id": "prov-1", "gpu_model_name": "A100", "region": "US",
        }))
        provider.setup_server(server)

        result = provider.deploy_miner(server, {"miner_command": "python -m miner"})
        assert result is True
        assert server.status == "started"

    def test_mock_deploy_miner_unknown_server_returns_false(self):
        provider = MockProvider()
        server = Server(provider_instance_id="nonexistent")
        result = provider.deploy_miner(server, {})
        assert result is False


# ---------- setup_server tests ----------


class TestSetupServer:
    @pytest.mark.asyncio
    async def test_mock_setup_server_sets_provisioned(self):
        provider = MockProvider()
        server = await provider.provision_server(fake_deployment({
            "id": "of-1", "provider_id": "prov-1", "gpu_model_name": "A100", "region": "US",
        }))

        result = provider.setup_server(server)
        assert result is True
        assert server.status == "provisioned"

    def test_mock_setup_server_unknown_server_returns_false(self):
        provider = MockProvider()
        server = Server(provider_instance_id="nonexistent")
        result = provider.setup_server(server)
        assert result is False


# ---------- get_status tests ----------


class TestGetStatus:
    def test_mock_get_status_structure(self):
        provider = MockProvider()
        server = Server(provider_instance_id="test-123")
        status = provider.get_status(server)
        assert "provider" in status
        assert "provider_instance_id" in status
        assert "status" in status
        assert status["provider"] == "mock"

    @pytest.mark.asyncio
    async def test_mock_get_status_running_miner(self):
        provider = MockProvider()
        server = await provider.provision_server(fake_deployment({
            "id": "of-1", "provider_id": "prov-1", "gpu_model_name": "A100", "region": "US",
        }))
        provider.setup_server(server)
        provider.deploy_miner(server, {})

        status = provider.get_status(server)
        assert status["miner_running"] is True

    @pytest.mark.asyncio
    async def test_mock_get_status_stopped_miner(self):
        provider = MockProvider()
        server = await provider.provision_server(fake_deployment({
            "id": "of-1", "provider_id": "prov-1", "gpu_model_name": "A100", "region": "US",
        }))
        provider.setup_server(server)
        provider.deploy_miner(server, {})
        provider.stop_miner(server)

        status = provider.get_status(server)
        assert status["miner_running"] is False


# ---------- parameterized lifecycle tests ----------


CONCRETE_PROVIDERS = [
    ("mock", MockProvider),
    ("runpod", RunPodProvider),
    ("vastai", VastAIProvider),
    ("tensordock", TensorDockProvider),
    ("e2e", E2EProvider),
]


class TestProviderLifecycle:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("name,cls", CONCRETE_PROVIDERS)
    async def test_provision_returns_server(self, name, cls):
        provider = cls()
        deployment = fake_deployment({
            "id": "of-1",
            "provider_id": "prov-1",
            "gpu_model_name": "A100",
            "region": "US",
        })

        if name == "mock":
            server = await provider.provision_server(deployment)
            assert isinstance(server, Server)
            assert server.status == "provisioning"
            assert server.deployment_id == "dep-1"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("name,cls", CONCRETE_PROVIDERS)
    async def test_provision_server_has_required_fields(self, name, cls):
        provider = cls()
        deployment = fake_deployment({
            "id": "of-1",
            "provider_id": "prov-1",
            "gpu_model_name": "A100",
            "region": "US",
        })

        if name == "mock":
            server = await provider.provision_server(deployment)
            assert server.provider_instance_id is not None
            assert server.gpu_model == "A100"
            assert server.deployment_id == "dep-1"


# ---------- Server field validation ----------


class TestServerFieldPopulation:
    @pytest.mark.asyncio
    async def test_mock_server_fields_from_offer(self):
        provider = MockProvider()
        offer = {
            "id": "of-1",
            "provider_id": "prov-1",
            "gpu_model_name": "A100",
            "region": "EU",
            "gpu_count": 2,
            "vram_gb": 80,
            "ram_gb": 256,
            "cpu_cores": 16,
            "storage_gb": 1000,
            "hourly_cost": 2.5,
            "currency": "USD",
        }
        deployment = fake_deployment(offer)
        server = await provider.provision_server(deployment)

        assert server.gpu_model == "A100"
        assert server.region == "EU"
        assert server.deployment_id == "dep-1"
        assert server.provider_id == "prov-1"
