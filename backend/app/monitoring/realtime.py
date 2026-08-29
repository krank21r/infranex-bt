"""
Server-Sent Events (SSE) broadcaster for real-time monitoring updates.

Maintains a small in-memory queue per connected client. A background
task pops events and writes them to each open response stream. When a
client disconnects, its queue is drained and removed.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import AsyncGenerator

from fastapi import Request

from app.monitoring.schemas import Alert, MinerHealthSummary, SubnetPerformance

logger = logging.getLogger(__name__)


class EventBroadcaster:
    """Fan-out SSE events to connected browser clients."""

    def __init__(self) -> None:
        self._queues: dict[str, asyncio.Queue] = {}
        self._lock = asyncio.Lock()

    async def subscribe(self, client_id: str) -> asyncio.Queue:
        async with self._lock:
            queue: asyncio.Queue = asyncio.Queue(maxsize=100)
            self._queues[client_id] = queue
            logger.debug("SSE client subscribed: %s", client_id)
            return queue

    async def unsubscribe(self, client_id: str) -> None:
        async with self._lock:
            self._queues.pop(client_id, None)
            logger.debug("SSE client unsubscribed: %s", client_id)

    async def publish(self, event: dict) -> None:
        async with self._lock:
            dead: list[str] = []
            for cid, q in self._queues.items():
                if q.full():
                    dead.append(cid)
                else:
                    q.put_nowait(event)
            for cid in dead:
                self._queues.pop(cid, None)


broadcaster = EventBroadcaster()


async def sse_event_stream(request: Request, client_id: str) -> AsyncGenerator[str, None]:
    queue = await broadcaster.subscribe(client_id)
    try:
        while True:
            if await request.is_disconnected():
                break
            try:
                event = await asyncio.wait_for(queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                yield ": heartbeat\n\n"
                continue
            payload = json.dumps(event, default=str)
            yield f"data: {payload}\n\n"
    except asyncio.CancelledError:
        pass
    finally:
        await broadcaster.unsubscribe(client_id)


async def push_miner_health(summary: MinerHealthSummary) -> None:
    await broadcaster.publish(
        {
            "type": "miner_health",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "payload": summary.model_dump(),
        }
    )


async def push_alert(alert: Alert) -> None:
    await broadcaster.publish(
        {
            "type": "alert",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "payload": alert.model_dump(),
        }
    )


async def push_subnet_performance(perf: SubnetPerformance) -> None:
    await broadcaster.publish(
        {
            "type": "subnet_performance",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "payload": perf.model_dump(),
        }
    )
