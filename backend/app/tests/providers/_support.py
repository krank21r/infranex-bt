"""
Shared test support for provider adapter tests.

Provides a fake `httpx.Client` and small stand-ins so adapter tests can
exercise the full lifecycle without any real network calls. Mirrors the
mock-first style used elsewhere in the suite (see
`tests/clients/test_fake_bittensor_client.py`).
"""
from types import SimpleNamespace
from typing import Any, Dict, Tuple
from unittest.mock import MagicMock


class FakeResponse:
    """Minimal stand-in for an `httpx.Response`."""

    def __init__(self, payload: Dict[str, Any]):
        self._payload = payload
        self.status_code = 200

    def raise_for_status(self) -> None:
        return None

    def json(self) -> Dict[str, Any]:
        return self._payload


class FakeHttpClient:
    """Records calls and returns canned responses.

    `router` maps ``(method, url)`` -> payload dict. Optional query
    inspection can be done via ``calls`` (list of (method, url, kwargs)).
    """

    def __init__(
        self,
        router: Dict[Tuple[str, str], Dict[str, Any]],
        default: Dict[str, Any] | None = None,
    ) -> None:
        self.router = router
        self.default = default or {}
        self.calls: list[Tuple[str, str, Dict[str, Any]]] = []

    def _respond(self, method: str, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append((method, url, kwargs))
        payload = self.router.get((method, url), self.default)
        return FakeResponse(payload)

    def post(self, url: str, **kwargs: Any) -> FakeResponse:
        return self._respond("POST", url, **kwargs)

    def get(self, url: str, **kwargs: Any) -> FakeResponse:
        return self._respond("GET", url, **kwargs)

    def put(self, url: str, **kwargs: Any) -> FakeResponse:
        return self._respond("PUT", url, **kwargs)

    def delete(self, url: str, **kwargs: Any) -> FakeResponse:
        return self._respond("DELETE", url, **kwargs)

    def request(self, method: str, url: str, **kwargs: Any) -> FakeResponse:
        return self._respond(method.upper(), url, **kwargs)


def magic_client(payload: Dict[str, Any]) -> MagicMock:
    """Convenience: a MagicMock client whose every call returns `payload`."""
    client = MagicMock()
    resp = MagicMock()
    resp.raise_for_status.return_value = None
    resp.json.return_value = payload
    client.post.return_value = resp
    client.get.return_value = resp
    client.put.return_value = resp
    client.request.return_value = resp
    client.delete.return_value = resp
    return client


def fake_deployment(offer: Dict[str, Any], *, dep_id: str = "dep-1") -> SimpleNamespace:
    """Stand-in Deployment with a snapshotted offer in `deployment_config`."""
    return SimpleNamespace(
        id=dep_id,
        deployment_config={"offer": offer},
    )
