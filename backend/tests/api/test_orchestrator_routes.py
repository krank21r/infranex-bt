"""
Miner Orchestrator route integration tests.

Verifies:
  - All orchestrator endpoints are registered in OpenAPI.
"""
from fastapi.testclient import TestClient


def _client() -> TestClient:
    from app.main import app
    return TestClient(app)


_EXPECTED_ORCHESTRATOR_PATHS = [
    "/api/orchestrator/tick",
    "/api/orchestrator/process",
    "/api/orchestrator/status",
]


def test_orchestrator_routes_registered_in_openapi():
    client = _client()
    schema = client.get("/openapi.json").json()
    registered = set(schema["paths"].keys())
    for path in _EXPECTED_ORCHESTRATOR_PATHS:
        assert path in registered, f"Orchestrator endpoint {path} missing from OpenAPI schema"
