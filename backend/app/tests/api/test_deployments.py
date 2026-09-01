from fastapi.testclient import TestClient

os_environ_defaults = {
    "DATABASE_URL": "postgresql://localhost/test",
    "SUPABASE_URL": "https://localhost.test",
    "SUPABASE_ANON_KEY": "test-anon-key",
    "SUPABASE_SERVICE_ROLE_KEY": "test-service-key",
}


def _client() -> TestClient:
    import os
    for k, v in os_environ_defaults.items():
        os.environ.setdefault(k, v)
    from app.main import app
    return TestClient(app)


_EXPECTED_DEPLOYMENT_PATHS = [
    "/api/v1/deployments",
    "/api/v1/deployments/{deployment_id}",
    "/api/v1/deployments/{deployment_id}/approve",
    "/api/v1/deployments/{deployment_id}/provision",
    "/api/v1/deployments/{deployment_id}/deploy",
    "/api/v1/deployments/{deployment_id}/terminate",
]


def test_deployment_routes_registered_in_openapi():
    client = _client()
    schema = client.get("/openapi.json").json()
    paths = set(schema["paths"].keys())
    for path in _EXPECTED_DEPLOYMENT_PATHS:
        assert path in paths, f"Deployment route {path!r} missing from OpenAPI schema"


def test_deployment_routes_have_approval_gate_schema():
    client = _client()
    schema = client.get("/openapi.json").json()
    approve_path = "/api/v1/deployments/{deployment_id}/approve"
    approve_op = schema["paths"][approve_path].get("post")
    assert approve_op is not None
    assert "requestBody" in approve_op or "parameters" in approve_op


def test_deployment_routes_have_terminate_schema():
    client = _client()
    schema = client.get("/openapi.json").json()
    terminate_path = "/api/v1/deployments/{deployment_id}/terminate"
    terminate_op = schema["paths"][terminate_path].get("post")
    assert terminate_op is not None
    assert "requestBody" in terminate_op or "parameters" in terminate_op


def test_deployment_create_post_method_registered():
    client = _client()
    schema = client.get("/openapi.json").json()
    create_path = "/api/v1/deployments"
    create_op = schema["paths"][create_path].get("post")
    assert create_op is not None
    assert "requestBody" in create_op


def test_deployment_list_get_method_registered():
    client = _client()
    schema = client.get("/openapi.json").json()
    list_path = "/api/v1/deployments"
    list_op = schema["paths"][list_path].get("get")
    assert list_op is not None
    assert list_op.get("summary") or list_op.get("operationId")
