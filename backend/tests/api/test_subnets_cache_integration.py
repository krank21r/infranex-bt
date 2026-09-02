"""
Integration test for the cache-first read path on the subnets API.

Pins the contract that:
- A cache hit for /subnets/{netuid} returns a payload with the same
  shape as the DB-serialized payload (no field regressions).
- A cache miss falls through to the DB (we don't simulate DB here, but
  we confirm the cache miss is detected and the fallback branch is
  taken — the DB service is the caller's responsibility).
- A cache hit for /subnets/{netuid}/metrics returns a metrics payload
  that has the same keys as the DB-serialized metrics payload.
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.api.routes.subnets import (
    _cached_to_subnet_payload,
    _serialize_cached_metrics,
    _serialize_metrics,
    _serialize_subnet,
)


def _orm_subnet(netuid: int = 1) -> SimpleNamespace:
    return SimpleNamespace(
        id="00000000-0000-0000-0000-000000000001",
        netuid=netuid,
        name="alpha",
        description="text subnet",
        subnet_type="text",
        owner_hotkey="5Owner",
        max_neurons=256,
        tempo=360,
        difficulty=100_000_000,
        is_active=True,
        registration_open=True,
        created_at=None,
        updated_at=None,
    )


def _orm_metrics(netuid: int = 1) -> SimpleNamespace:
    return SimpleNamespace(
        netuid=netuid,
        block=12345,
        emission=1.0,
        average_incentive=0.5,
        total_stake=10_000.0,
        top_5_concentration=0.6,
        miner_count=100,
        validator_count=10,
        trust=0.9,
        consensus=0.85,
        recorded_at=None,
    )


def test_cached_payload_has_same_keys_as_db_payload() -> None:
    """Cache hit must not introduce or drop any field vs the DB path."""
    db_payload = _serialize_subnet(_orm_subnet())
    db_payload["latest_metrics"] = _serialize_metrics(_orm_metrics())

    cached_meta = {
        "id": db_payload["id"],
        "netuid": db_payload["netuid"],
        "name": db_payload["name"],
        "description": db_payload["description"],
        "subnet_type": db_payload["subnet_type"],
        "owner_hotkey": db_payload["owner_hotkey"],
        "max_neurons": db_payload["max_neurons"],
        "tempo": db_payload["tempo"],
        "difficulty": db_payload["difficulty"],
        "is_active": db_payload["is_active"],
        "registration_open": db_payload["registration_open"],
        "created_at": db_payload["created_at"],
        "updated_at": db_payload["updated_at"],
    }
    cached_metrics = {
        "netuid": 1,
        "block": 12345,
        "emission": 1.0,
        "average_incentive": 0.5,
        "total_stake": 10_000.0,
        "top_5_concentration": 0.6,
        "miner_count": 100,
        "validator_count": 10,
        "trust": 0.9,
        "consensus": 0.85,
        "recorded_at": None,
    }
    cached_payload = _cached_to_subnet_payload(cached_meta, cached_metrics)

    assert set(cached_payload.keys()) == set(db_payload.keys())
    assert cached_payload["latest_metrics"] is not None
    assert set(cached_payload["latest_metrics"].keys()) == set(db_payload["latest_metrics"].keys())


def test_cached_metrics_payload_has_same_keys_as_db_payload() -> None:
    db = _serialize_metrics(_orm_metrics())
    cached = _serialize_cached_metrics({
        "netuid": 1, "block": 12345, "emission": 1.0,
        "average_incentive": 0.5, "total_stake": 10_000.0,
        "top_5_concentration": 0.6, "miner_count": 100, "validator_count": 10,
        "trust": 0.9, "consensus": 0.85, "recorded_at": None,
    })
    assert set(cached.keys()) == set(db.keys())


def test_cached_metrics_coerces_numeric_strings() -> None:
    """Defensive: cached values may round-trip as strings under some
    serializers; the projection must still return numbers for numeric fields."""
    cached = _serialize_cached_metrics({
        "netuid": 1, "block": 12345, "emission": "1.0",
        "average_incentive": "0.5", "total_stake": "10000.0",
        "top_5_concentration": "0.6", "miner_count": 100, "validator_count": 10,
        "trust": "0.9", "consensus": "0.85", "recorded_at": None,
    })
    assert cached["emission"] == 1.0
    assert cached["total_stake"] == 10000.0


def test_cached_metrics_handles_none_values() -> None:
    cached = _serialize_cached_metrics({
        "netuid": 1, "block": None, "emission": None,
        "average_incentive": None, "total_stake": None,
        "top_5_concentration": None, "miner_count": None, "validator_count": None,
        "trust": None, "consensus": None, "recorded_at": None,
    })
    assert cached["emission"] is None
    assert cached["block"] is None
    assert cached["miner_count"] is None


def test_cached_payload_latest_metrics_none_when_missing() -> None:
    payload = _cached_to_subnet_payload(
        {"netuid": 1, "name": "x"}, None,
    )
    assert payload["latest_metrics"] is None


@pytest.mark.asyncio
async def test_get_subnet_cache_hit_skips_db() -> None:
    """The route must not call SubnetService.get_subnet when the cache hits."""
    from app.api.routes import subnets as subnets_route

    fake_cache = AsyncMock()
    fake_cache.get_subnet_meta = AsyncMock(return_value={
        "id": None, "netuid": 1, "name": "cached", "description": None,
        "subnet_type": None, "owner_hotkey": None, "max_neurons": None,
        "tempo": None, "difficulty": None, "is_active": True,
        "registration_open": True, "created_at": None, "updated_at": None,
    })
    fake_cache.get_subnet_metrics = AsyncMock(return_value={
        "netuid": 1, "block": 1, "emission": 1.0, "average_incentive": 0.5,
        "total_stake": 100.0, "top_5_concentration": 0.5,
        "miner_count": 10, "validator_count": 1, "trust": 0.9, "consensus": 0.8,
        "recorded_at": None,
    })
    fake_service = AsyncMock()
    fake_service.get_subnet = AsyncMock()

    with patch.object(subnets_route, "SubnetCache", return_value=fake_cache):
        response = await subnets_route.get_subnet(
            netuid=1, db=AsyncMock(), subnet_service=fake_service,
        )

    assert response.success is True
    assert response.data["name"] == "cached"
    assert response.data["latest_metrics"] is not None
    fake_service.get_subnet.assert_not_called()
    fake_service.latest_metrics.assert_not_called()


@pytest.mark.asyncio
async def test_get_subnet_cache_miss_falls_through_to_db() -> None:
    from app.api.routes import subnets as subnets_route

    fake_cache = AsyncMock()
    fake_cache.get_subnet_meta = AsyncMock(return_value=None)
    fake_cache.get_subnet_metrics = AsyncMock(return_value=None)
    fake_service = AsyncMock()
    fake_service.get_subnet = AsyncMock(return_value=_orm_subnet(1))
    fake_service.latest_metrics = AsyncMock(return_value=_orm_metrics(1))

    with patch.object(subnets_route, "SubnetCache", return_value=fake_cache):
        response = await subnets_route.get_subnet(
            netuid=1, db=AsyncMock(), subnet_service=fake_service,
        )

    assert response.success is True
    assert response.data["name"] == "alpha"
    fake_service.get_subnet.assert_awaited_once_with(1)


@pytest.mark.asyncio
async def test_get_subnet_metrics_cache_hit_skips_db() -> None:
    from app.api.routes import subnets as subnets_route

    fake_cache = AsyncMock()
    fake_cache.get_subnet_metrics = AsyncMock(return_value={
        "netuid": 1, "block": 1, "emission": 1.0, "average_incentive": 0.5,
        "total_stake": 100.0, "top_5_concentration": 0.5,
        "miner_count": 10, "validator_count": 1, "trust": 0.9, "consensus": 0.8,
        "recorded_at": None,
    })
    fake_service = AsyncMock()
    fake_service.latest_metrics = AsyncMock()

    with patch.object(subnets_route, "SubnetCache", return_value=fake_cache):
        response = await subnets_route.get_subnet_metrics(
            netuid=1, db=AsyncMock(), subnet_service=fake_service,
        )

    assert response.success is True
    assert response.data["netuid"] == 1
    fake_service.latest_metrics.assert_not_called()
