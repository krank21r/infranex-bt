"""
Redis cache layer for the Bittensor data pipeline.

Two backends, one interface:
- TCP: `redis.asyncio.from_url(settings.REDIS_URL)` — used in local dev and
  for any Upstash instance reachable over TCP (e.g. Fly-internal Redis).
- Upstash REST: `httpx.AsyncClient` against `settings.UPSTASH_REDIS_REST_URL`
  using `settings.UPSTASH_REDIS_REST_TOKEN` — used in Vercel serverless
  deployments where long-lived TCP sockets are not viable.

Both backends expose the same `get`/`set`/`delete` semantics used by the
rest of the app. The cache layer itself never raises on backend errors;
callers get `None` on miss/error and write paths log + swallow so a
Redis outage cannot break the scanner or the API.

Key schema (all keys are namespaced under ``infranex:``):
- ``infranex:subnets:latest``          -> JSON list[dict] of all known subnets
- ``infranex:subnet:{netuid}:meta``    -> JSON dict, single subnet row
- ``infranex:subnet:{netuid}:metrics`` -> JSON dict, latest metrics snapshot
- ``infranex:subnet:{netuid}:neurons`` -> JSON list[dict], latest neurons

TTLs:
- ``latest`` family: 300s (matches scanner interval)
- meta: 900s (subnet fields change slowly)
- metrics/neurons: 300s
"""
from __future__ import annotations

import json
import logging
from collections.abc import Sequence
from typing import Any, Protocol

import redis.asyncio as aioredis

from app.core.config import settings

logger = logging.getLogger(__name__)

_NS = "infranex"

K_SUBNETS_LATEST = f"{_NS}:subnets:latest"
K_SUBNET_META = lambda netuid: f"{_NS}:subnet:{netuid}:meta"  # noqa: E731
K_SUBNET_METRICS = lambda netuid: f"{_NS}:subnet:{netuid}:metrics"  # noqa: E731
K_SUBNET_NEURONS = lambda netuid: f"{_NS}:subnet:{netuid}:neurons"  # noqa: E731

TTL_LATEST = 300
TTL_META = 900
TTL_METRICS = 300
TTL_NEURONS = 300


class _Backend(Protocol):
    async def get(self, key: str) -> str | None: ...
    async def set(self, key: str, value: str, ex: int | None = None) -> None: ...
    async def delete(self, *keys: str) -> int: ...
    async def ping(self) -> bool: ...
    async def close(self) -> None: ...


class _TcpBackend:
    """Async TCP Redis backend using redis.asyncio."""

    _pool: aioredis.Redis | None = None

    @classmethod
    def _client(cls) -> aioredis.Redis:
        if cls._pool is None:
            cls._pool = aioredis.from_url(
                settings.effective_redis_url,
                max_connections=settings.REDIS_MAX_CONNECTIONS,
                decode_responses=True,
            )
        return cls._pool

    async def get(self, key: str) -> str | None:
        return await self._client().get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        await self._client().set(key, value, ex=ex)

    async def delete(self, *keys: str) -> int:
        return int(await self._client().delete(*keys))

    async def ping(self) -> bool:
        try:
            return bool(await self._client().ping())
        except Exception:
            return False

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            _TcpBackend._pool = None


class _UpstashRestBackend:
    """Upstash Redis via REST API. Works on Vercel serverless."""

    def __init__(self) -> None:
        import httpx

        self._httpx = httpx
        self._base = settings.UPSTASH_REDIS_REST_URL.rstrip("/")
        self._token = settings.UPSTASH_REDIS_REST_TOKEN
        self._headers = {"Authorization": f"Bearer {self._token}"}
        self._client: httpx.AsyncClient | None = None

    async def _http(self) -> "httpx.AsyncClient":
        if self._client is None:
            self._client = self._httpx.AsyncClient(timeout=5.0)
        return self._client

    async def _exec(self, *cmd: str) -> Any:
        try:
            client = await self._http()
            r = await client.post(
                f"{self._base}/pipeline",
                headers=self._headers,
                json=[list(cmd)],
            )
            r.raise_for_status()
            data = r.json()
            if not data or "result" not in data[0]:
                return None
            return data[0]["result"]
        except Exception as e:
            logger.warning("upstash_rest_exec_failed cmd=%s err=%s", cmd[0], e)
            return None

    async def get(self, key: str) -> str | None:
        result = await self._exec("GET", key)
        return result if isinstance(result, str) else None

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        if ex is not None:
            await self._exec("SET", key, value, "EX", str(ex))
        else:
            await self._exec("SET", key, value)

    async def delete(self, *keys: str) -> int:
        result = await self._exec("DEL", *keys)
        return int(result) if result is not None else 0

    async def ping(self) -> bool:
        result = await self._exec("PING")
        return result == "PONG"

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None


def _select_backend() -> _Backend:
    if settings.APP_ENV == "production" and settings.UPSTASH_REDIS_REST_URL and settings.UPSTASH_REDIS_REST_TOKEN:
        return _UpstashRestBackend()
    return _TcpBackend()


class SubnetCache:
    """High-level cache operations for subnet / metrics / neurons data.

    All methods are tolerant of backend failures — they log and return
    a miss / no-op rather than raising, so a Redis outage degrades
    performance but doesn't break the caller.
    """

    def __init__(self, backend: _Backend | None = None) -> None:
        self._backend: _Backend = backend or _select_backend()

    async def ping(self) -> bool:
        try:
            return await self._backend.ping()
        except Exception as e:
            logger.warning("cache_ping_failed err=%s", e)
            return False

    async def close(self) -> None:
        try:
            await self._backend.close()
        except Exception:
            pass

    async def get_subnets_latest(self) -> list[dict] | None:
        raw = await self._safe_get(K_SUBNETS_LATEST)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except (TypeError, ValueError) as e:
            logger.warning("cache_decode_failed key=%s err=%s", K_SUBNETS_LATEST, e)
            return None

    async def set_subnets_latest(self, subnets: Sequence[dict]) -> None:
        try:
            payload = json.dumps(list(subnets), default=str)
        except (TypeError, ValueError) as e:
            logger.warning("cache_encode_failed key=%s err=%s", K_SUBNETS_LATEST, e)
            return
        await self._safe_set(K_SUBNETS_LATEST, payload, TTL_LATEST)

    async def get_subnet_meta(self, netuid: int) -> dict | None:
        raw = await self._safe_get(K_SUBNET_META(netuid))
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except (TypeError, ValueError):
            return None

    async def set_subnet_meta(self, netuid: int, meta: dict) -> None:
        try:
            payload = json.dumps(meta, default=str)
        except (TypeError, ValueError):
            return
        await self._safe_set(K_SUBNET_META(netuid), payload, TTL_META)

    async def get_subnet_metrics(self, netuid: int) -> dict | None:
        raw = await self._safe_get(K_SUBNET_METRICS(netuid))
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except (TypeError, ValueError):
            return None

    async def set_subnet_metrics(self, netuid: int, metrics: dict) -> None:
        try:
            payload = json.dumps(metrics, default=str)
        except (TypeError, ValueError):
            return
        await self._safe_set(K_SUBNET_METRICS(netuid), payload, TTL_METRICS)

    async def get_subnet_neurons(self, netuid: int) -> list[dict] | None:
        raw = await self._safe_get(K_SUBNET_NEURONS(netuid))
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except (TypeError, ValueError):
            return None

    async def set_subnet_neurons(self, netuid: int, neurons: Sequence[dict]) -> None:
        try:
            payload = json.dumps(list(neurons), default=str)
        except (TypeError, ValueError):
            return
        await self._safe_set(K_SUBNET_NEURONS(netuid), payload, TTL_NEURONS)

    async def invalidate_subnet(self, netuid: int) -> int:
        """Drop all cached values for a single subnet. Returns number actually removed."""
        try:
            return int(await self._backend.delete(
                K_SUBNET_META(netuid),
                K_SUBNET_METRICS(netuid),
                K_SUBNET_NEURONS(netuid),
            ))
        except Exception as e:
            logger.warning("cache_invalidate_failed netuid=%s err=%s", netuid, e)
            return 0

    async def invalidate_all(self) -> int:
        """Drop the global subnets list. Used when the schema shifts or after a manual seed."""
        try:
            return int(await self._backend.delete(K_SUBNETS_LATEST))
        except Exception as e:
            logger.warning("cache_invalidate_all_failed err=%s", e)
            return 0

    async def _safe_get(self, key: str) -> str | None:
        try:
            return await self._backend.get(key)
        except Exception as e:
            logger.warning("cache_get_failed key=%s err=%s", key, e)
            return None

    async def _safe_set(self, key: str, value: str, ttl: int) -> None:
        try:
            await self._backend.set(key, value, ex=ttl)
        except Exception as e:
            logger.warning("cache_set_failed key=%s err=%s", key, e)
