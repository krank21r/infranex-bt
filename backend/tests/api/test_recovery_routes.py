"""
Recovery route integration tests.

Verifies:
  - All recovery endpoints are registered in OpenAPI.
"""
from fastapi.testclient import TestClient


def _client() -> TestClient:
    from app.main import app
    return TestClient(app)


_EXPECTED_RECOVERY_PATHS = [
    "/api/recover/decide",
    "/api/recover/health/{miner_id}",
]


def test_recovery_routes_registered_in_openapi():
    client = _client()
    schema = client.get("/openapi.json").json()
    registered = set(schema["paths"].keys())
    assert "/api/recover/decide" in registered
    assert any(p.startswith("/api/recover/health/") for p in registered), (
        "recover/health/{miner_id} endpoint missing from OpenAPI schema"
    )
