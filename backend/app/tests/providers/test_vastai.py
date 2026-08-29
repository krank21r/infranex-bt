"""
Tests for VastAIProvider (mocked REST calls).

Verifies the API surface (search_offers, create/start/stop/destroy
instance) and the GPUProvider lifecycle wiring, all with an injected
`httpx.Client`.
"""
import pytest

from app.models.deployment import Server
from app.providers.vastai import VASTAI_API_URL, VastAIProvider

from app.tests.providers._support import fake_deployment, magic_client


@pytest.fixture
def client():
    return magic_client({})


def _offer():
    return {
        "id": "of-1",
        "provider_id": "prov-1",
        "provider_offer_id": "ask-123",
        "gpu_model_name": "A100",
        "region": "US",
    }


def test_vastai_reads_api_key_from_env(monkeypatch):
    monkeypatch.setenv("VASTAI_API_KEY", "vk-test")
    assert VastAIProvider().api_key == "vk-test"


def test_search_offers(client):
    client.request.return_value.json.return_value = {"offers": [{"id": "ask-1"}]}
    provider = VastAIProvider(api_key="vk", client=client)
    offers = provider.search_offers(query={"num_gpus": 1})
    assert offers == [{"id": "ask-1"}]
    method, url, kwargs = client.request.call_args.args[0], client.request.call_args.args[1], client.request.call_args.kwargs
    assert method == "PUT"
    assert url == f"{VASTAI_API_URL}/bundles/"
    assert kwargs["headers"]["Authorization"] == "Bearer vk"


def test_create_instance_posts_to_asks(client):
    client.request.return_value.json.return_value = {"new_contract": 555}
    provider = VastAIProvider(api_key="vk", client=client)
    result = provider.create_instance(ask_id="ask-123", image="x/y:z")
    assert result["new_contract"] == 555
    assert "asks/ask-123" in client.request.call_args.args[1]


@pytest.mark.asyncio
async def test_provision_server_creates_server(client):
    client.request.return_value.json.return_value = {
        "id": 555,
        "ssh_host": "10.0.0.5",
        "ssh_port": 2222,
    }
    provider = VastAIProvider(api_key="vk", client=client)
    server = await provider.provision_server(fake_deployment(_offer(), dep_id="d1"))
    assert server.provider_instance_id == "555"
    assert server.ip_address == "10.0.0.5"
    assert server.ssh_port == 2222
    assert server.deployment_id == "d1"


@pytest.mark.asyncio
async def test_provision_requires_ask_id(client):
    provider = VastAIProvider(api_key="vk", client=client)
    with pytest.raises(ValueError):
        await provider.provision_server(fake_deployment({}))


def test_stop_and_terminate_instance(client):
    provider = VastAIProvider(api_key="vk", client=client)
    server = Server(provider_instance_id="555", status="started")
    assert provider.stop_miner(server) is True
    assert server.status == "stopped"

    assert provider.terminate_server(server) is True
    assert server.status == "terminated"

    methods = [c.args[0] for c in client.request.call_args_list]
    assert "POST" in methods
    assert "DELETE" in methods
    # The stop POST carried state=stopped.
    stop_call = next(c for c in client.request.call_args_list if c.args[0] == "POST")
    assert stop_call.kwargs["json"]["state"] == "stopped"
