"""
Tests for E2EProvider (mocked REST calls).

Verifies the node API surface (list plans / create / start / stop /
destroy) and the GPUProvider lifecycle wiring with an injected
`httpx.Client`. E2E uses a Project-ID header alongside the Bearer token.

NOTE: E2EProvider routes every call through `client.request(...)`, so the
tests assert against `client.request.call_args*` rather than the
per-method helpers.
"""
import pytest

from app.models.deployment import Server
from app.providers.e2e import E2E_API_URL, E2EProvider

from app.tests.providers._support import fake_deployment, magic_client


@pytest.fixture
def client():
    return magic_client({})


def _offer():
    return {
        "id": "of-1",
        "provider_id": "prov-1",
        "provider_offer_id": "gpu-rtx4090",
        "gpu_model_name": "RTX 4090",
        "region": "cnr",
    }


def test_e2e_reads_api_key_and_project(monkeypatch):
    monkeypatch.setenv("E2E_API_KEY", "ek")
    monkeypatch.setenv("E2E_PROJECT_ID", "proj-1")
    provider = E2EProvider()
    assert provider.api_key == "ek"
    assert provider.project_id == "proj-1"


def test_list_gpu_plans(client):
    client.request.return_value.json.return_value = {"data": [{"plan_code": "gpu-rtx4090"}]}
    provider = E2EProvider(api_key="ek", project_id="p1", client=client)
    plans = provider.list_gpu_plans()
    assert plans == [{"plan_code": "gpu-rtx4090"}]
    assert client.request.call_args.args[1] == f"{E2E_API_URL}/compute/gpu-plans"
    assert client.request.call_args.kwargs["headers"]["Project-ID"] == "p1"


def test_create_instance_posts_nodes(client):
    client.request.return_value.json.return_value = {"data": {"id": "node-3", "ip_address": "5.5.5.5"}}
    provider = E2EProvider(api_key="ek", project_id="p1", client=client)
    result = provider.create_instance(name="infranex-x", plan_code="gpu-rtx4090")
    assert result["data"]["id"] == "node-3"
    assert "nodes" in client.request.call_args.args[1]


@pytest.mark.asyncio
async def test_provision_server_creates_server(client):
    client.request.return_value.json.return_value = {"data": {"id": "node-3", "ip_address": "5.5.5.5"}}
    provider = E2EProvider(api_key="ek", project_id="p1", client=client)
    server = await provider.provision_server(fake_deployment(_offer(), dep_id="d3"))
    assert server.provider_instance_id == "node-3"
    assert server.ip_address == "5.5.5.5"
    assert server.region == "cnr"


def test_lifecycle_calls_node_endpoints(client):
    provider = E2EProvider(api_key="ek", client=client)
    server = Server(provider_instance_id="node-3", status="started")

    assert provider.stop_miner(server) is True
    assert server.status == "stopped"
    assert "nodes/node-3/stop" in client.request.call_args.args[1]

    assert provider.terminate_server(server) is True
    assert server.status == "terminated"
    assert client.request.call_args.args[0] == "DELETE"
    assert f"{E2E_API_URL}/compute/nodes/node-3" in client.request.call_args.args[1]
