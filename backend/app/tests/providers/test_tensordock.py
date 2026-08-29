"""
Tests for TensorDockProvider (mocked REST calls).

Verifies the marketplace API surface (search/create/start/stop/destroy)
and the GPUProvider lifecycle wiring with an injected `httpx.Client`.

NOTE: TensorDockProvider routes every call through `client.request(...)`,
so the tests assert against `client.request.call_args*` rather than the
per-method helpers.
"""
import pytest

from app.models.deployment import Server
from app.providers.tensordock import TENSORDOCK_API_URL, TensorDockProvider

from app.tests.providers._support import fake_deployment, magic_client


@pytest.fixture
def client():
    return magic_client({})


def _offer():
    return {
        "id": "of-1",
        "provider_id": "prov-1",
        "gpu_model_name": "RTX 4090",
        "region": "us-east",
    }


def test_tensordock_reads_api_key_and_secret(monkeypatch):
    monkeypatch.setenv("TENSORDOCK_API_KEY", "tk")
    monkeypatch.setenv("TENSORDOCK_API_SECRET", "ts")
    provider = TensorDockProvider()
    assert provider.api_key == "tk"
    assert provider.api_secret == "ts"


def test_search_offers(client):
    client.request.return_value.json.return_value = {"offers": [{"id": "o1"}]}
    provider = TensorDockProvider(api_key="tk", client=client)
    offers = provider.search_offers(params={"gpu": "4090"})
    assert offers == [{"id": "o1"}]
    assert client.request.call_args.args[1] == f"{TENSORDOCK_API_URL}/search"


def test_create_instance_posts_rent(client):
    client.request.return_value.json.return_value = {"id": "inst-7"}
    provider = TensorDockProvider(api_key="tk", client=client)
    result = provider.create_instance(gpu_model="RTX 4090", region="us-east")
    assert result["id"] == "inst-7"
    assert "rent" in client.request.call_args.args[1]
    assert client.request.call_args.kwargs["json"]["gpu_model"] == "RTX 4090"


@pytest.mark.asyncio
async def test_provision_server_creates_server(client):
    client.request.return_value.json.return_value = {"id": "inst-7", "ip": "9.9.9.9"}
    provider = TensorDockProvider(api_key="tk", client=client)
    server = await provider.provision_server(fake_deployment(_offer(), dep_id="d2"))
    assert server.provider_instance_id == "inst-7"
    assert server.ip_address == "9.9.9.9"
    assert server.gpu_model == "RTX 4090"


def test_lifecycle_calls_market_endpoints(client):
    provider = TensorDockProvider(api_key="tk", client=client)
    server = Server(provider_instance_id="inst-7", status="started")

    assert provider.stop_miner(server) is True
    assert server.status == "stopped"
    assert "stop/inst-7" in client.request.call_args.args[1]

    assert provider.terminate_server(server) is True
    assert server.status == "terminated"
    assert "destroy/inst-7" in client.request.call_args.args[1]
