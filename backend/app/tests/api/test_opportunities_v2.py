"""
Opportunities v2.0 route integration tests.

Verifies:
  - All v2 endpoints are registered in OpenAPI.
  - POST /api/v2/opportunities/score returns a full v2 score payload.
  - GET /api/v2/opportunities/{netuid}/decision returns decision fields.
  - GET /api/v2/opportunities/decisions supports pagination + decision filter.
  - GET /api/v2/opportunities/watchlist returns only WATCH subnets.
  - POST /api/v2/opportunities/score-all returns status + netuid list.
  - GET /api/v2/opportunities/{netuid}/history returns pillar score timeline.
  - POST /api/v2/opportunities/compare returns side-by-side breakdown.
"""
import os
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient


os.environ.setdefault("DATABASE_URL", "postgresql://localhost/test")
os.environ.setdefault("SUPABASE_URL", "https://localhost.test")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-key")


def _client() -> TestClient:
    from app.main import app
    return TestClient(app)


_EXPECTED_V2_PATHS = [
    "/api/v2/opportunities/score",
    "/api/v2/opportunities/{netuid}/decision",
    "/api/v2/opportunities/decisions",
    "/api/v2/opportunities/watchlist",
    "/api/v2/opportunities/score-all",
    "/api/v2/opportunities/{netuid}/history",
    "/api/v2/opportunities/compare",
]


# ---------------------------------------------------------------------------
# OpenAPI registration
# ---------------------------------------------------------------------------

def test_v2_routes_registered_in_openapi():
    client = _client()
    schema = client.get("/openapi.json").json()
    registered = set(schema["paths"].keys())
    for path in _EXPECTED_V2_PATHS:
        assert path in registered, f"V2 endpoint {path} missing from OpenAPI schema"


# ---------------------------------------------------------------------------
# POST /api/v2/opportunities/score
# ---------------------------------------------------------------------------

def test_score_endpoint_returns_v2_payload():
    client = _client()
    mock_score = {
        "netuid": 1,
        "subnet_name": "test-subnet",
        "total_score": 82.5,
        "model_version": "v2.0",
        "decision": "RUN",
        "pillar_scores": {"economic_potential": 80.0, "competition": 70.0},
        "weights": {"economic_potential": 0.2, "competition": 0.15},
        "components": [
            {"name": "economic_potential", "score": 80.0, "weight": 0.2, "weighted": 16.0, "explanation": "ok"},
        ],
        "summary": "Opportunity Score 83/100.",
        "constraints_violated": [],
        "approval_level": "L3_mandatory",
        "reason": "Score 82.5 exceeds ENTER threshold 75.0",
    }

    with patch("app.api.routes.opportunities_v2._score_and_decide", new_callable=AsyncMock, return_value=mock_score):
        resp = client.post("/api/v2/opportunities/score", json={"netuid": 1, "include_components": True})
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    data = body["data"]
    assert data["netuid"] == 1
    assert data["decision"] == "RUN"
    assert data["approval_level"] == "L3_mandatory"
    assert "pillar_scores" in data
    assert "components" in data


def test_score_endpoint_returns_404_when_missing():
    client = _client()
    with patch("app.api.routes.opportunities_v2._score_and_decide", new_callable=AsyncMock, return_value=None):
        resp = client.post("/api/v2/opportunities/score", json={"netuid": 999})
    assert resp.status_code == 404


def test_score_endpoint_returns_422_on_invalid_input():
    client = _client()
    resp = client.post("/api/v2/opportunities/score", json={"netuid": -1})
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# GET /api/v2/opportunities/{netuid}/decision
# ---------------------------------------------------------------------------

def test_decision_endpoint_returns_decision_fields():
    client = _client()
    mock_score = {
        "netuid": 2,
        "subnet_name": "watch-subnet",
        "total_score": 55.0,
        "model_version": "v2.0",
        "decision": "WATCH",
        "pillar_scores": {"economic_potential": 50.0},
        "weights": {"economic_potential": 0.2},
        "components": [],
        "summary": "Opportunity Score 55/100.",
        "constraints_violated": [],
        "approval_level": "L1_auto",
        "reason": "Score 55.0 in HOLD band [40.0, 75.0)",
    }

    with patch("app.api.routes.opportunities_v2._score_and_decide", new_callable=AsyncMock, return_value=mock_score):
        resp = client.get("/api/v2/opportunities/2/decision")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    data = body["data"]
    assert data["netuid"] == 2
    assert data["decision"] == "WATCH"
    assert data["approval_level"] == "L1_auto"
    assert "constraints_violated" in data
    assert "reason" in data


# ---------------------------------------------------------------------------
# GET /api/v2/opportunities/decisions
# ---------------------------------------------------------------------------

def test_decisions_endpoint_filters_by_decision():
    client = _client()
    mock_items = [
        {"netuid": 1, "decision": "RUN", "total_score": 90.0, "pillar_scores": {}, "weights": {}, "components": [], "summary": "", "constraints_violated": [], "approval_level": "L3_mandatory", "reason": ""},
        {"netuid": 2, "decision": "WATCH", "total_score": 55.0, "pillar_scores": {}, "weights": {}, "components": [], "summary": "", "constraints_violated": [], "approval_level": "L1_auto", "reason": ""},
    ]

    with patch("app.api.routes.opportunities_v2._score_and_decide", new_callable=AsyncMock, side_effect=mock_items):
        with patch("app.api.routes.opportunities_v2.SubnetService") as MockSvc:
            instance = MockSvc.return_value
            instance.get_known_netuids = AsyncMock(return_value=[1, 2])
            resp = client.get("/api/v2/opportunities/decisions?decision=RUN&page=1&page_size=10")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert len(body["data"]) == 1
    assert body["data"][0]["decision"] == "RUN"


def test_decisions_endpoint_pagination_meta():
    client = _client()
    mock_items = [
        {"netuid": i, "decision": "AVOID", "total_score": 10.0 * i, "pillar_scores": {}, "weights": {}, "components": [], "summary": "", "constraints_violated": [], "approval_level": "L1_auto", "reason": ""}
        for i in range(1, 6)
    ]

    with patch("app.api.routes.opportunities_v2._score_and_decide", new_callable=AsyncMock, side_effect=mock_items):
        with patch("app.api.routes.opportunities_v2.SubnetService") as MockSvc:
            instance = MockSvc.return_value
            instance.get_known_netuids = AsyncMock(return_value=list(range(1, 6)))
            resp = client.get("/api/v2/opportunities/decisions?page=1&page_size=2")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert len(body["data"]) == 2
    assert body["meta"]["page"] == 1
    assert body["meta"]["page_size"] == 2
    assert body["meta"]["total_items"] == 5
    assert body["meta"]["has_next"] is True


# ---------------------------------------------------------------------------
# GET /api/v2/opportunities/watchlist
# ---------------------------------------------------------------------------

def test_watchlist_endpoint_returns_only_watch():
    client = _client()
    mock_items = [
        {"netuid": 1, "decision": "WATCH", "total_score": 60.0, "pillar_scores": {}, "weights": {}, "components": [], "summary": "", "constraints_violated": [], "approval_level": "L1_auto", "reason": ""},
        {"netuid": 2, "decision": "RUN", "total_score": 90.0, "pillar_scores": {}, "weights": {}, "components": [], "summary": "", "constraints_violated": [], "approval_level": "L3_mandatory", "reason": ""},
    ]

    with patch("app.api.routes.opportunities_v2._score_and_decide", new_callable=AsyncMock, side_effect=mock_items):
        with patch("app.api.routes.opportunities_v2.SubnetService") as MockSvc:
            instance = MockSvc.return_value
            instance.get_known_netuids = AsyncMock(return_value=[1, 2])
            resp = client.get("/api/v2/opportunities/watchlist")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert len(body["data"]) == 1
    assert body["data"][0]["decision"] == "WATCH"


# ---------------------------------------------------------------------------
# POST /api/v2/opportunities/score-all
# ---------------------------------------------------------------------------

def test_score_all_endpoint_returns_status():
    client = _client()
    with patch("app.api.routes.opportunities_v2.SubnetService") as MockSvc:
        instance = MockSvc.return_value
        instance.get_known_netuids = AsyncMock(return_value=[1, 2, 3])
        resp = client.post("/api/v2/opportunities/score-all")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    data = body["data"]
    assert data["status"] == "started"
    assert data["netuids"] == [1, 2, 3]
    assert data["estimated_seconds"] >= 1


# ---------------------------------------------------------------------------
# GET /api/v2/opportunities/{netuid}/history
# ---------------------------------------------------------------------------

def test_history_endpoint_returns_pillar_timeline():
    client = _client()
    now = datetime.now(timezone.utc)
    mock_points = [
        {"recorded_at": now - timedelta(days=2), "total_score": 65.0, "pillar_scores": {"economic_potential": 60.0}},
        {"recorded_at": now - timedelta(days=1), "total_score": 70.0, "pillar_scores": {"economic_potential": 65.0}},
    ]

    fake_result = MagicMock()
    fake_result.scalars.return_value.all.return_value = [
        MagicMock(recorded_at=now - timedelta(days=2)),
        MagicMock(recorded_at=now - timedelta(days=1)),
    ]

    from app.api.deps import get_db
    from app.main import app
    from app.api.routes import opportunities_v2

    async def _override_get_db():
        session = MagicMock()
        session.execute = AsyncMock(return_value=fake_result)
        yield session

    app.dependency_overrides[get_db] = _override_get_db
    try:
        with patch.object(opportunities_v2.SubnetMetricsHistory, "recorded_at", now):
            with patch("app.api.routes.opportunities_v2.compute_opportunity_score", return_value={
                "total_score": 70.0,
                "components": [
                    {"name": "economic_potential", "score": 65.0, "weight": 0.2, "weighted": 13.0, "explanation": ""},
                ],
            }):
                resp = client.get("/api/v2/opportunities/1/history?days=30")
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert len(body["data"]) == 2
    finally:
        app.dependency_overrides.pop(get_db, None)


# ---------------------------------------------------------------------------
# POST /api/v2/opportunities/compare
# ---------------------------------------------------------------------------

def test_compare_endpoint_returns_side_by_side():
    client = _client()
    mock_items = [
        {"netuid": 1, "subnet_name": "A", "total_score": 90.0, "pillar_scores": {"economic_potential": 90.0}, "weights": {}, "components": [], "summary": "", "constraints_violated": [], "approval_level": "L3_mandatory", "reason": ""},
        {"netuid": 2, "subnet_name": "B", "total_score": 70.0, "pillar_scores": {"economic_potential": 70.0}, "weights": {}, "components": [], "summary": "", "constraints_violated": [], "approval_level": "L1_auto", "reason": ""},
    ]

    with patch("app.api.routes.opportunities_v2._score_and_decide", new_callable=AsyncMock, side_effect=mock_items):
        resp = client.post("/api/v2/opportunities/compare", json={"netuids": [1, 2]})
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    data = body["data"]
    assert len(data) == 2
    assert data[0]["total_score"] >= data[1]["total_score"]


def test_compare_endpoint_returns_422_on_too_few_netuids():
    client = _client()
    resp = client.post("/api/v2/opportunities/compare", json={"netuids": [1]})
    assert resp.status_code == 422
