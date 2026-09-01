"""
Tests for MockProvider (full lifecycle).

Pins the in-memory contract: provision -> setup -> deploy_miner ->
stop_miner -> terminate, plus get_status coherence. No external calls.
"""
import pytest

from app.models.deployment import Server
from app.providers.mock import MockProvider
from app.tests.providers._support import fake_deployment


@pytest.fixture
def provider() -> MockProvider:
    return MockProvider()


def _offer():
    return {
        "id": "of-1",
        "provider_id": "prov-1",
        "gpu_model_name": "A100",
        "region": "US",
    }


@pytest.mark.asyncio
async def test_provision_creates_server_with_stable_id(provider: MockProvider):
    deployment = fake_deployment(_offer())
    server = await provider.provision_server(deployment)
    assert isinstance(server, Server)
    assert server.provider_instance_id.startswith("mock-srv-")
    assert server.status == "provisioning"
    assert server.gpu_model == "A100"
    assert server.deployment_id == "dep-1"


@pytest.mark.asyncio
async def test_ids_are_monotonic(provider: MockProvider):
    d1 = await provider.provision_server(fake_deployment(_offer(), dep_id="a"))
    d2 = await provider.provision_server(fake_deployment(_offer(), dep_id="b"))
    assert d1.provider_instance_id != d2.provider_instance_id


@pytest.mark.asyncio
async def test_full_lifecycle(provider: MockProvider):
    server = await provider.provision_server(fake_deployment(_offer()))
    assert provider.setup_server(server) is True
    assert server.status == "provisioned"

    assert provider.deploy_miner(server, {"miner_command": "python -m miner"}) is True
    assert server.status == "started"
    assert provider.get_status(server)["miner_running"] is True

    assert provider.stop_miner(server) is True
    assert server.status == "stopped"
    assert provider.get_status(server)["miner_running"] is False

    assert provider.terminate_server(server) is True
    assert server.status == "terminated"


def test_setup_unknown_server_returns_false(provider: MockProvider):
    server = Server(provider_instance_id="does-not-exist")
    assert provider.setup_server(server) is False
    assert provider.deploy_miner(server, {}) is False
    assert provider.stop_miner(server) is False


def test_get_status_for_unknown_server(provider: MockProvider):
    server = Server(provider_instance_id="ghost")
    status = provider.get_status(server)
    assert status["provider"] == "mock"
    assert status["miner_running"] is False
