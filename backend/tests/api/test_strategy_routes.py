"""
Strategy Engine route integration tests.

Verifies:
  - All strategy endpoints are registered in OpenAPI.
  - POST /api/strategy/evaluate returns a valid Action dict.
  - POST /api/strategy/evaluate-batch returns sorted Actions.
  - POST /api/strategy/evaluate returns 422 when required fields are missing.
"""
import pytest
from fastapi.testclient import TestClient


def _client() -> TestClient:
    from app.main import app
    return TestClient(app)


_EXPECTED_STRATEGY_PATHS = [
    "/api/strategy/evaluate",
    "/api/strategy/evaluate-batch",
    "/api/strategy/portfolio",
]


def test_strategy_routes_registered_in_openapi():
    client = _client()
    schema = client.get("/openapi.json").json()
    registered = set(schema["paths"].keys())
    for path in _EXPECTED_STRATEGY_PATHS:
        assert path in registered, f"Strategy endpoint {path} missing from OpenAPI schema"


def test_evaluate_endpoint_returns_action():
    client = _client()
    payload = {
        "netuid": 1,
        "score": 85.0,
        "portfolio_state": {
            "current_miners": [],
            "pending_deployments": [],
            "monthly_spend_inr": 0.0,
        },
    }
    resp = client.post("/api/strategy/evaluate", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    data = body["data"]
    assert data["action_type"] == "run"
    assert data["netuid"] == 1
    assert data["score"] == 85.0
    assert "model_version" in data


def test_evaluate_batch_endpoint_returns_sorted_actions():
    client = _client()
    payload = {
        "opportunities": [
            {"netuid": 1, "total_score": 50.0, "subnet_name": "A"},
            {"netuid": 2, "total_score": 90.0, "subnet_name": "B"},
            {"netuid": 3, "total_score": 10.0, "subnet_name": "C"},
        ],
        "portfolio_state": {
            "current_miners": [],
            "pending_deployments": [],
            "monthly_spend_inr": 0.0,
        },
    }
    resp = client.post("/api/strategy/evaluate-batch", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    actions = body["data"]
    assert len(actions) == 3
    action_types = [a["action_type"] for a in actions]
    assert action_types == ["run", "watch", "avoid"]
    netuids = [a["netuid"] for a in actions]
    assert netuids == [2, 1, 3]


def test_evaluate_endpoint_returns_422_on_missing_fields():
    client = _client()
    resp = client.post("/api/strategy/evaluate", json={})
    assert resp.status_code == 422
