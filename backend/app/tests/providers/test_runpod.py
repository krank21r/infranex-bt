"""
Tests for RunPodProvider (mocked GraphQL calls).

All network access goes through the injected `httpx.Client`, so we
assert on the request shape (URL + GraphQL query presence) and the
resulting `Server` without leaving the process.
"""
import httpx
import pytest

from app.providers.runpod import RUNPOD_API_URL, RunPodProvider
from app.tests.providers._support import fake_deployment, magic_client


@pytest.fixture
def client():
    return magic_client({"data": {}})


def _offer():
    return {
        "id": "of-1",
        "provider_id": "prov-1",
        "provider_offer_id": "NVIDIA A100 80GB PCIe",
        "gpu_model_name": "A100",
        "region": "US",
    }


def test_runpod_reads_api_key_from_env(monkeypatch):
    monkeypatch.setenv("RUNPOD_API_KEY", "rk-test")
    provider = RunPodProvider()
    assert provider.api_key == "rk-test"
    provider2 = RunPodProvider(api_key="explicit")
    assert provider2.api_key == "explicit"


def test_get_gpu_types_posts_graphql(client):
    client.post.return_value.json.return_value = {
        "data": {"gpuTypes": [{"id": "A100", "displayName": "A100"}]}
    }
    provider = RunPodProvider(api_key="rk", client=client)
    types = provider.get_gpu_types()
    assert types == [{"id": "A100", "displayName": "A100"}]
    args, kwargs = client.post.call_args
    assert args[0] == RUNPOD_API_URL
    assert "query" in kwargs["json"]
    assert kwargs["headers"]["Authorization"] == "Bearer rk"


def test_list_gpu_types_alias(client):
    client.post.return_value.json.return_value = {
        "data": {"gpuTypes": [{"id": "A100", "displayName": "A100"}]}
    }
    provider = RunPodProvider(api_key="rk", client=client)
    assert provider.list_gpu_types() == [{"id": "A100", "displayName": "A100"}]


def test_create_pod_returns_pod_dict(client):
    client.post.return_value.json.return_value = {
        "data": {"podFindAndDeployOnDemand": {"id": "pod-9", "desiredStatus": "RUNNING"}}
    }
    provider = RunPodProvider(api_key="rk", client=client)
    pod = provider.create_pod(gpu_type_id="A100", name="x")
    assert pod["id"] == "pod-9"
    sent = client.post.call_args.kwargs["json"]["variables"]["input"]
    assert sent["gpuTypeId"] == "A100"
    assert sent["env"] == []


def test_start_stop_destroy_pod(client):
    client.post.return_value.json.return_value = {
        "data": {
            "podResume": {"id": "pod-9"},
            "podSuspend": {"id": "pod-9"},
            "podTerminate": {},
        }
    }
    provider = RunPodProvider(api_key="rk", client=client)
    assert provider.start_pod("pod-9")["id"] == "pod-9"
    assert provider.stop_pod("pod-9")["id"] == "pod-9"
    assert provider.destroy_pod("pod-9") == {}


@pytest.mark.asyncio
async def test_provision_server_creates_server_from_pod(client):
    client.post.return_value.json.return_value = {
        "data": {
            "podFindAndDeployOnDemand": {
                "id": "pod-42",
                "ip": "1.2.3.4",
                "desiredStatus": "RUNNING",
            }
        }
    }
    provider = RunPodProvider(api_key="rk", client=client)
    server = await provider.provision_server(fake_deployment(_offer(), dep_id="dep-x"))
    assert server.provider_instance_id == "pod-42"
    assert server.ip_address == "1.2.3.4"
    assert server.status == "provisioning"
    assert server.deployment_id == "dep-x"


@pytest.mark.asyncio
async def test_provision_requires_gpu_type_id(client):
    provider = RunPodProvider(api_key="rk", client=client)
    with pytest.raises(ValueError):
        await provider.provision_server(fake_deployment({}))


def test_terminate_server_stops_pod(client):
    provider = RunPodProvider(api_key="rk", client=client)
    from app.models.deployment import Server

    server = Server(provider_instance_id="pod-9", status="started")
    assert provider.terminate_server(server) is True
    assert server.status == "terminated"
    sent_query = client.post.call_args.kwargs["json"]["query"]
    assert "podTerminate" in sent_query


def test_terminate_server_without_instance_id_is_false(client):
    provider = RunPodProvider(api_key="rk", client=client)
    from app.models.deployment import Server

    server = Server(provider_instance_id=None)
    assert provider.terminate_server(server) is False


def test_stop_miner_suspends_pod(client):
    client.post.return_value.json.return_value = {
        "data": {"podSuspend": {"id": "pod-9", "desiredStatus": "STOPPED"}}
    }
    provider = RunPodProvider(api_key="rk", client=client)
    from app.models.deployment import Server

    server = Server(provider_instance_id="pod-9", status="started")
    assert provider.stop_miner(server) is True
    assert server.status == "stopped"
    sent_query = client.post.call_args.kwargs["json"]["query"]
    assert "podSuspend" in sent_query


def test_get_status_queries_pod_status(client):
    client.post.return_value.json.return_value = {
        "data": {"pod": {"actualStatus": "RUNNING", "desiredStatus": "RUNNING"}}
    }
    provider = RunPodProvider(api_key="rk", client=client)
    from app.models.deployment import Server

    server = Server(provider_instance_id="pod-9", status="provisioning")
    status = provider.get_status(server)
    assert status["status"] == "RUNNING"
    assert status["provider_instance_id"] == "pod-9"
    sent_query = client.post.call_args.kwargs["json"]["query"]
    assert "pod(" in sent_query
    assert "podId" in sent_query


def test_get_status_falls_back_on_api_failure(client):
    client.post.return_value.json.return_value = {
        "data": {},
        "errors": [{"message": "some transient error"}],
    }
    provider = RunPodProvider(api_key="rk", client=client)
    from app.models.deployment import Server

    server = Server(provider_instance_id="pod-9", status="started")
    status = provider.get_status(server)
    assert status["status"] == "started"
    assert status["provider_instance_id"] == "pod-9"


def test_get_status_unknown_without_instance_id(client):
    provider = RunPodProvider(api_key="rk", client=client)
    from app.models.deployment import Server

    server = Server(provider_instance_id=None)
    status = provider.get_status(server)
    assert status["status"] == "unknown"
    assert status["provider_instance_id"] is None


def test_graphql_retries_on_timeout():
    from unittest.mock import MagicMock

    provider = RunPodProvider(api_key="rk")
    mock_client = MagicMock()
    provider._client = mock_client

    timeout_exc = httpx.TimeoutException("boom")

    success_resp = MagicMock()
    success_resp.status_code = 200
    success_resp.json.return_value = {"data": {"gpuTypes": []}}
    success_resp.raise_for_status.return_value = None

    mock_client.post.side_effect = [timeout_exc, timeout_exc, success_resp]

    result = provider._graphql("query { gpuTypes { id } }", {})
    assert result == {"gpuTypes": []}
    assert mock_client.post.call_count == 3


def test_graphql_retries_on_rate_limit():
    from unittest.mock import MagicMock

    provider = RunPodProvider(api_key="rk")
    mock_client = MagicMock()
    provider._client = mock_client

    rate_limit_resp = MagicMock()
    rate_limit_resp.status_code = 429
    rate_limit_resp.raise_for_status.side_effect = httpx.HTTPStatusError(
        "Rate limited",
        request=MagicMock(),
        response=rate_limit_resp,
    )

    success_resp = MagicMock()
    success_resp.status_code = 200
    success_resp.json.return_value = {"data": {"gpuTypes": []}}
    success_resp.raise_for_status.return_value = None

    mock_client.post.side_effect = [rate_limit_resp, success_resp]

    result = provider._graphql("query { gpuTypes { id } }", {})
    assert result == {"gpuTypes": []}
    assert mock_client.post.call_count == 2


def test_graphql_insufficient_funds_raises(client):
    client.post.return_value.json.return_value = {
        "data": {},
        "errors": [{"message": "Insufficient funds in account"}],
    }
    provider = RunPodProvider(api_key="rk", client=client)
    with pytest.raises(RuntimeError, match="Insufficient funds"):
        provider._graphql("query {}", {})


def test_graphql_invalid_gpu_type_raises(client):
    client.post.return_value.json.return_value = {
        "data": {},
        "errors": [{"message": "Invalid GPU type specified"}],
    }
    provider = RunPodProvider(api_key="rk", client=client)
    with pytest.raises(ValueError, match="Invalid GPU type"):
        provider._graphql("query {}", {})


def test_graphql_generic_error_raises(client):
    client.post.return_value.json.return_value = {
        "data": {},
        "errors": [{"message": "Something went wrong"}],
    }
    provider = RunPodProvider(api_key="rk", client=client)
    with pytest.raises(RuntimeError, match="RunPod GraphQL error"):
        provider._graphql("query {}", {})
