"""
Learning Engine route integration tests.

Verifies:
  - All learning endpoints are registered in OpenAPI.
"""
import pytest
from fastapi.testclient import TestClient


def _client() -> TestClient:
    from app.main import app
    return TestClient(app)


_EXPECTED_LEARNING_PATHS = [
    "/api/learning/status",
    "/api/learning/feedback",
    "/api/learning/accuracy",
]


def test_learning_routes_registered_in_openapi():
    client = _client()
    schema = client.get("/openapi.json").json()
    registered = set(schema["paths"].keys())
    for path in _EXPECTED_LEARNING_PATHS:
        assert path in registered, f"Learning endpoint {path} missing from OpenAPI schema"
