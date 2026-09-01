"""
Smoke tests for the FastAPI application.

The bar here is low and intentional: we want a single signal that says
"the app loads, the routes are mounted, and the most basic endpoints
respond." If any of these break, the deployment is broken - the tests
will catch it in CI before users see it.

We deliberately do NOT spin up a database. The routes that touch the
DB will be covered by integration tests against a real Postgres in a
later pass; this file only proves the wiring is intact.
"""
from fastapi import FastAPI
from fastapi.testclient import TestClient


def test_app_imports():
    """`from app.main import app` must succeed with no exceptions."""
    from app.main import app
    assert app is not None


def test_app_is_fastapi_instance():
    from app.main import app
    assert isinstance(app, FastAPI)


def test_root_endpoint():
    from app.main import app
    client = TestClient(app)
    resp = client.get("/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Infranex BT"
    assert body["health"] == "/api/health"


def test_openapi_schema_generated():
    from app.main import app
    client = TestClient(app)
    resp = client.get("/openapi.json")
    assert resp.status_code == 200
    schema = resp.json()
    # FastAPI always emits these
    assert schema["info"]["title"] == "Infranex BT"
    # Our api_router is mounted under /api (concrete paths only - no prefix key)
    assert any(p.startswith("/api/") for p in schema["paths"]), "no /api/* paths registered"


def test_health_endpoint_registered():
    from app.main import app
    client = TestClient(app)
    # /api/health exists in the openapi schema
    resp = client.get("/openapi.json")
    paths = resp.json()["paths"]
    assert "/api/health" in paths


def test_approvals_router_registered():
    """The approvals router is the new pillar 1 wiring - if it
    disappears from the schema, the closed loop is broken."""
    from app.main import app
    client = TestClient(app)
    resp = client.get("/openapi.json")
    paths = resp.json()["paths"]
    approval_paths = [p for p in paths if p.startswith("/api/approvals")]
    assert approval_paths, "approval router is not mounted"


def test_cron_router_registered():
    """The cron router is what Vercel Cron hits - it must be present
    in the schema, otherwise the scheduled workers never run."""
    from app.main import app
    client = TestClient(app)
    resp = client.get("/openapi.json")
    paths = resp.json()["paths"]
    cron_paths = [p for p in paths if p.startswith("/api/cron/")]
    assert cron_paths, "cron router is not mounted"
    # All three expected crons are wired
    expected = {"/api/cron/market-data", "/api/cron/scanner", "/api/cron/scoring"}
    assert expected.issubset(set(cron_paths))


def test_unknown_route_returns_404():
    from app.main import app
    client = TestClient(app)
    resp = client.get("/this/does/not/exist")
    assert resp.status_code == 404
