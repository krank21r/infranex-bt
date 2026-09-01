from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_user, get_db
from app.schemas.auth import User
from app.services.user_miner_service import UserMinerService

TEST_USER_ID = "00000000-0000-0000-0000-000000000001"


def _user() -> User:
    return User(
        id=TEST_USER_ID,
        email="test@infranex.com",
        full_name="Test User",
        avatar_url=None,
        created_at=datetime.now(timezone.utc),
        updated_at=None,
        is_active=True,
        is_verified=False,
        role="user",
        metadata={},
    )


_FAKE_NETUIDS = (1, 3, 64)


def _fake_hotkey(netuid: int, uid: int = 0) -> str:
    return f"5FakeNeuronHotkey{netuid:03d}{uid:03d}aaaaaaaaaaaaaaaaaaaaaaaa"


@pytest.fixture(autouse=True)
def _reset_store():
    UserMinerService.reset_store()
    yield
    UserMinerService.reset_store()


@pytest.fixture()
def client() -> TestClient:
    from app.api.routes import user_miners
    from app.main import app as _app

    _mock_subnet = type("Subnet", (), {"name": "test-subnet"})()

    async def _mock_get_subnet(*args, **kwargs):
        return _mock_subnet

    _app.dependency_overrides[get_current_user] = _user
    _app.dependency_overrides[get_db] = lambda: None

    with patch.object(user_miners.SubnetService, "get_subnet", _mock_get_subnet):
        yield TestClient(_app)
    _app.dependency_overrides.clear()


def test_register_miner_success(client: TestClient):
    netuid = _FAKE_NETUIDS[0]
    hotkey = _fake_hotkey(netuid)
    resp = client.post(
        "/api/miners/register",
        json={
            "name": "Miner One",
            "hotkey": hotkey,
            "netuid": netuid,
            "description": "desc",
            "tags": ["alpha"],
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["name"] == "Miner One"
    assert body["data"]["hotkey"] == hotkey
    assert body["data"]["subnet_name"] == "test-subnet"
    assert body["data"]["uid"] == 0


def test_register_miner_missing_hotkey(client: TestClient):
    resp = client.post(
        "/api/miners/register",
        json={"name": "Bad", "hotkey": "", "netuid": 1},
    )
    assert resp.status_code == 422


def test_list_my_miners(client: TestClient):
    netuid = _FAKE_NETUIDS[0]
    hotkey = _fake_hotkey(netuid)
    client.post("/api/miners/register", json={"name": "Miner One", "hotkey": hotkey, "netuid": netuid})
    resp = client.get("/api/miners/my")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    assert len(body["data"]) == 1
    assert body["data"][0]["name"] == "Miner One"


def test_get_my_miner(client: TestClient):
    netuid = _FAKE_NETUIDS[1]
    hotkey = _fake_hotkey(netuid)
    created = client.post(
        "/api/miners/register", json={"name": "Miner Two", "hotkey": hotkey, "netuid": netuid}
    ).json()
    miner_id = created["data"]["id"]
    resp = client.get(f"/api/miners/my/{miner_id}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["name"] == "Miner Two"
    assert body["data"]["netuid"] == netuid


def test_get_my_miner_not_found(client: TestClient):
    resp = client.get(f"/api/miners/my/{uuid.uuid4()}")
    assert resp.status_code == 404


def test_update_my_miner(client: TestClient):
    netuid = _FAKE_NETUIDS[1]
    hotkey = _fake_hotkey(netuid)
    created = client.post(
        "/api/miners/register", json={"name": "Old Name", "hotkey": hotkey, "netuid": netuid}
    ).json()
    miner_id = created["data"]["id"]
    resp = client.patch(
        f"/api/miners/my/{miner_id}",
        json={"name": "New Name", "tags": ["beta", "gamma"]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["name"] == "New Name"
    assert body["data"]["tags"] == ["beta", "gamma"]


def test_update_my_miner_not_found(client: TestClient):
    resp = client.patch(f"/api/miners/my/{uuid.uuid4()}", json={"name": "Noop"})
    assert resp.status_code == 404


def test_delete_my_miner(client: TestClient):
    netuid = _FAKE_NETUIDS[2]
    hotkey = _fake_hotkey(netuid)
    created = client.post(
        "/api/miners/register", json={"name": "To Delete", "hotkey": hotkey, "netuid": netuid}
    ).json()
    miner_id = created["data"]["id"]
    resp = client.delete(f"/api/miners/my/{miner_id}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["deleted"] is True
    assert client.get(f"/api/miners/my/{miner_id}").status_code == 404


def test_delete_my_miner_not_found(client: TestClient):
    resp = client.delete(f"/api/miners/my/{uuid.uuid4()}")
    assert resp.status_code == 404


def test_authorization_other_user_cannot_access(client: TestClient):
    netuid = _FAKE_NETUIDS[0]
    hotkey = _fake_hotkey(netuid)
    created = client.post(
        "/api/miners/register", json={"name": "Owner", "hotkey": hotkey, "netuid": netuid}
    ).json()
    miner_id = created["data"]["id"]

    other = User(
        id="00000000-0000-0000-0000-000000000002",
        email="other@infranex.com",
        full_name="Other",
        avatar_url=None,
        created_at=datetime.now(timezone.utc),
        updated_at=None,
        is_active=True,
        is_verified=False,
        role="user",
        metadata={},
    )

    from app.api.routes import user_miners
    from app.main import app as _app

    original = _app.dependency_overrides.get(get_current_user)
    _app.dependency_overrides[get_current_user] = lambda: other
    try:
        with patch.object(user_miners.SubnetService, "get_subnet", return_value=None):
            resp = client.get(f"/api/miners/my/{miner_id}")
            assert resp.status_code == 404, resp.text
    finally:
        if original is None:
            _app.dependency_overrides.pop(get_current_user, None)
        else:
            _app.dependency_overrides[get_current_user] = original


def test_hotkey_validation_invalid_format(client: TestClient):
    resp = client.post("/api/miners/validate-hotkey", json={"hotkey": "not-a-ss58", "netuid": 1})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["valid"] is False
    assert body["message"] == "invalid_ss58_format"


def test_hotkey_validation_not_found_on_chain(client: TestClient):
    hotkey = "5" + "0" * 47
    resp = client.post("/api/miners/validate-hotkey", json={"hotkey": hotkey, "netuid": 999})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["valid"] is False
    assert body["on_chain"] is False


def test_hotkey_validation_found_on_chain(client: TestClient):
    fake_hotkey = _fake_hotkey(1, uid=0)
    resp = client.post("/api/miners/validate-hotkey", json={"hotkey": fake_hotkey, "netuid": 1})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["valid"] is True
    assert body["on_chain"] is True
    assert body["uid"] == 0