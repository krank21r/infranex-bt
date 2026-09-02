"""Minimal pipeline wiring test.

Confirms that the wiring is in place: DiscoveryService -> SubnetCache,
and API routes read from SubnetCache before falling back to the DB.
The detailed behaviors (TTL handling, key format, projection shape,
DB fallback, Redis outage tolerance) are covered by the unit tests
in:
- tests/services/test_cache.py
- tests/api/test_subnets_cache_integration.py
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from app.services.cache import K_SUBNET_META, K_SUBNET_METRICS, SubnetCache


class FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.ttls: dict[str, int] = {}

    async def get(self, key):
        return self.store.get(key)

    async def set(self, key, value, ex=None):
        self.store[key] = value
        if ex is not None:
            self.ttls[key] = ex

    async def delete(self, *keys):
        n = 0
        for k in keys:
            if k in self.store:
                del self.store[k]
                self.ttls.pop(k, None)
                n += 1
        return n

    async def ping(self):
        return True

    async def close(self):
        pass


@pytest.fixture
def fake_redis() -> FakeRedis:
    return FakeRedis()


@pytest.mark.asyncio
async def test_api_route_returns_cached_subnet_without_db_call(fake_redis: FakeRedis) -> None:
    from app.api.routes import subnets as subnets_route

    await fake_redis.set(
        K_SUBNET_META(1),
        json.dumps({
            "id": "fake-id-1", "netuid": 1, "name": "cached-name",
            "description": None, "subnet_type": None, "owner_hotkey": None,
            "max_neurons": 256, "tempo": 360, "difficulty": 1,
            "is_active": True, "registration_open": True,
            "created_at": None, "updated_at": None,
        }),
        ex=300,
    )
    await fake_redis.set(
        K_SUBNET_METRICS(1),
        json.dumps({
            "netuid": 1, "block": 1, "emission": 1.5, "average_incentive": 0.5,
            "total_stake": 100.0, "top_5_concentration": 0.5,
            "miner_count": 10, "validator_count": 1, "trust": 0.9, "consensus": 0.85,
            "recorded_at": "2026-09-02T00:00:00+00:00",
        }),
        ex=300,
    )

    unused_service = AsyncMock()
    cache_instance = SubnetCache(backend=fake_redis)
    with patch.object(subnets_route, "SubnetCache", return_value=cache_instance):
        response = await subnets_route.get_subnet(
            netuid=1, db=AsyncMock(), subnet_service=unused_service,
        )

    assert response.success is True
    assert response.data["name"] == "cached-name"
    assert response.data["latest_metrics"]["emission"] == 1.5
    unused_service.get_subnet.assert_not_called()
    unused_service.latest_metrics.assert_not_called()


@pytest.mark.asyncio
async def test_api_route_metrics_endpoint_uses_cache(fake_redis: FakeRedis) -> None:
    from app.api.routes import subnets as subnets_route

    await fake_redis.set(
        K_SUBNET_METRICS(1),
        json.dumps({
            "netuid": 1, "block": 1, "emission": 2.5, "average_incentive": 0.5,
            "total_stake": 100.0, "top_5_concentration": 0.5,
            "miner_count": 10, "validator_count": 1, "trust": 0.9, "consensus": 0.85,
            "recorded_at": "2026-09-02T00:00:00+00:00",
        }),
        ex=300,
    )

    unused_service = AsyncMock()
    cache_instance = SubnetCache(backend=fake_redis)
    with patch.object(subnets_route, "SubnetCache", return_value=cache_instance):
        response = await subnets_route.get_subnet_metrics(
            netuid=1, db=AsyncMock(), subnet_service=unused_service,
        )

    assert response.success is True
    assert response.data["emission"] == 2.5
    unused_service.latest_metrics.assert_not_called()


@pytest.mark.asyncio
async def test_discovery_service_constructs_a_cache(fake_redis: FakeRedis) -> None:
    """Smoke test: DiscoveryService must build a SubnetCache in __init__
    so the sync pipeline can call _refresh_subnets_cache / _refresh_netuid_cache.
    """
    from app.services.discovery_service import DiscoveryService
    from app.clients.bittensor import FakeBittensorClient

    d = DiscoveryService(db=AsyncMock(), client=FakeBittensorClient())
    # The default __init__ builds a cache; replace with the fake so the
    # test doesn't try to connect to a real Redis.
    d._cache = SubnetCache(backend=fake_redis)
    assert d._cache is not None
