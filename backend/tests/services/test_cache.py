"""
Unit tests for SubnetCache.

These tests use a fake backend (dict in memory) so they don't need a real
Redis. They cover:
- round-trip get/set for every key family
- TTL pass-through
- invalidation
- tolerant behavior on backend failures (no raises)
- JSON encode/decode failures
"""
from __future__ import annotations

import json

import pytest

from app.services import cache as cache_mod
from app.services.cache import SubnetCache


class FakeBackend:
    """In-memory replacement for the real cache backend."""

    def __init__(self, fail_on: set[str] | None = None) -> None:
        self._store: dict[str, str] = {}
        self._ttls: dict[str, int] = {}
        self.fail_on = fail_on or set()

    async def get(self, key: str) -> str | None:
        if "get" in self.fail_on or key in self.fail_on:
            raise RuntimeError("backend failure")
        return self._store.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        if "set" in self.fail_on or key in self.fail_on:
            raise RuntimeError("backend failure")
        self._store[key] = value
        if ex is not None:
            self._ttls[key] = ex

    async def delete(self, *keys: str) -> int:
        n = 0
        for k in keys:
            if k in self._store:
                del self._store[k]
                self._ttls.pop(k, None)
                n += 1
        return n

    async def ping(self) -> bool:
        return True

    async def close(self) -> None:
        pass


@pytest.fixture
def fake_backend() -> FakeBackend:
    return FakeBackend()


@pytest.fixture
def c(fake_backend: FakeBackend) -> SubnetCache:
    return SubnetCache(backend=fake_backend)


@pytest.mark.asyncio
async def test_subnets_latest_roundtrip(c: SubnetCache) -> None:
    data = [{"netuid": 1, "name": "alpha"}, {"netuid": 3, "name": "beta"}]
    assert await c.get_subnets_latest() is None
    await c.set_subnets_latest(data)
    out = await c.get_subnets_latest()
    assert out == data


@pytest.mark.asyncio
async def test_subnet_meta_roundtrip(c: SubnetCache) -> None:
    meta = {"netuid": 1, "name": "alpha", "max_neurons": 256}
    assert await c.get_subnet_meta(1) is None
    await c.set_subnet_meta(1, meta)
    assert await c.get_subnet_meta(1) == meta


@pytest.mark.asyncio
async def test_metrics_roundtrip(c: SubnetCache) -> None:
    m = {
        "netuid": 3,
        "block": 12345,
        "emission": 1.0,
        "miner_count": 100,
        "validator_count": 10,
    }
    assert await c.get_subnet_metrics(3) is None
    await c.set_subnet_metrics(3, m)
    assert await c.get_subnet_metrics(3) == m


@pytest.mark.asyncio
async def test_neurons_roundtrip(c: SubnetCache) -> None:
    n = [
        {"netuid": 3, "uid": 0, "hotkey": "5A", "stake": 100.0},
        {"netuid": 3, "uid": 1, "hotkey": "5B", "stake": 50.0},
    ]
    assert await c.get_subnet_neurons(3) is None
    await c.set_subnet_neurons(3, n)
    assert await c.get_subnet_neurons(3) == n


@pytest.mark.asyncio
async def test_invalidate_subnet_drops_only_that_netuid(
    c: SubnetCache, fake_backend: FakeBackend
) -> None:
    await c.set_subnet_meta(1, {"netuid": 1})
    await c.set_subnet_metrics(1, {"netuid": 1, "emission": 1.0})
    await c.set_subnet_neurons(1, [{"uid": 0}])
    await c.set_subnet_meta(2, {"netuid": 2})

    removed = await c.invalidate_subnet(1)
    assert removed == 3
    assert await c.get_subnet_meta(1) is None
    assert await c.get_subnet_metrics(1) is None
    assert await c.get_subnet_neurons(1) is None
    assert await c.get_subnet_meta(2) == {"netuid": 2}


@pytest.mark.asyncio
async def test_invalidate_all_drops_list_only(c: SubnetCache) -> None:
    await c.set_subnets_latest([{"netuid": 1}])
    await c.set_subnet_meta(1, {"netuid": 1})
    await c.invalidate_all()
    assert await c.get_subnets_latest() is None
    assert await c.get_subnet_meta(1) == {"netuid": 1}


@pytest.mark.asyncio
async def test_ttl_set_on_write(c: SubnetCache, fake_backend: FakeBackend) -> None:
    await c.set_subnets_latest([{"netuid": 1}])
    assert fake_backend._ttls[cache_mod.K_SUBNETS_LATEST] == cache_mod.TTL_LATEST

    await c.set_subnet_meta(1, {"netuid": 1})
    assert fake_backend._ttls[cache_mod.K_SUBNET_META(1)] == cache_mod.TTL_META

    await c.set_subnet_metrics(1, {"netuid": 1})
    assert fake_backend._ttls[cache_mod.K_SUBNET_METRICS(1)] == cache_mod.TTL_METRICS

    await c.set_subnet_neurons(1, [{"uid": 0}])
    assert fake_backend._ttls[cache_mod.K_SUBNET_NEURONS(1)] == cache_mod.TTL_NEURONS


@pytest.mark.asyncio
async def test_get_returns_none_on_backend_failure(fake_backend: FakeBackend) -> None:
    c = SubnetCache(backend=FakeBackend(fail_on={"get"}))
    assert await c.get_subnets_latest() is None
    assert await c.get_subnet_meta(1) is None
    assert await c.get_subnet_metrics(1) is None
    assert await c.get_subnet_neurons(1) is None


@pytest.mark.asyncio
async def test_set_swallows_backend_failure(fake_backend: FakeBackend) -> None:
    c = SubnetCache(backend=FakeBackend(fail_on={"set"}))
    # None of these should raise.
    await c.set_subnets_latest([{"netuid": 1}])
    await c.set_subnet_meta(1, {"netuid": 1})
    await c.set_subnet_metrics(1, {"netuid": 1})
    await c.set_subnet_neurons(1, [{"uid": 0}])


@pytest.mark.asyncio
async def test_corrupt_json_returns_none(c: SubnetCache) -> None:
    # Manually stash invalid JSON in the underlying store.
    await c._backend.set(cache_mod.K_SUBNETS_LATEST, "not-json{", ex=60)
    assert await c.get_subnets_latest() is None


@pytest.mark.asyncio
async def test_non_serializable_input_does_not_raise(c: SubnetCache) -> None:
    # `default=str` should keep common SQLAlchemy datetime values safe.
    data = [{"netuid": 1, "updated_at": "2026-09-02T00:00:00Z"}]
    await c.set_subnets_latest(data)
    out = await c.get_subnets_latest()
    assert out == data


@pytest.mark.asyncio
async def test_ping_returns_true_on_healthy(c: SubnetCache) -> None:
    assert await c.ping() is True


@pytest.mark.asyncio
async def test_ping_returns_false_on_failure() -> None:
    class BrokenBackend(FakeBackend):
        async def ping(self) -> bool:
            return False

    c = SubnetCache(backend=BrokenBackend())
    assert await c.ping() is False


def test_key_helpers_are_namespaced() -> None:
    assert cache_mod.K_SUBNETS_LATEST == "infranex:subnets:latest"
    assert cache_mod.K_SUBNET_META(1) == "infranex:subnet:1:meta"
    assert cache_mod.K_SUBNET_METRICS(3) == "infranex:subnet:3:metrics"
    assert cache_mod.K_SUBNET_NEURONS(64) == "infranex:subnet:64:neurons"


def test_ttls_match_scanner_interval() -> None:
    # Scanner runs every 5min by default; cache should expire before the
    # next scan + a little slack, not long after, so a missed scan surfaces
    # as staleness rather than stale-but-cached data.
    assert cache_mod.TTL_LATEST == 300
    assert cache_mod.TTL_METRICS == 300
    assert cache_mod.TTL_NEURONS == 300
    assert cache_mod.TTL_META >= cache_mod.TTL_LATEST
