"""
Optimizer route integration tests.

Verifies:
  - All optimizer endpoints are registered in OpenAPI.
"""
from fastapi.testclient import TestClient


def _client() -> TestClient:
    from app.main import app
    return TestClient(app)


_EXPECTED_OPTIMIZER_PATHS = [
    "/api/optimizer/savings",
    "/api/optimizer/subnet-alternatives",
    "/api/optimizer/config-suggestions",
]


def test_optimizer_routes_registered_in_openapi():
    client = _client()
    schema = client.get("/openapi.json").json()
    registered = set(schema["paths"].keys())
    for path in _EXPECTED_OPTIMIZER_PATHS:
        assert path in registered, f"Optimizer endpoint {path} missing from OpenAPI schema"
