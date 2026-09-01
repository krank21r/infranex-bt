from __future__ import annotations

import threading
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.user_miner import (
    UserMinerCreate,
    UserMinerResponse,
    UserMinerUpdate,
)

_store_lock = threading.RLock()
_miners_by_user: dict[str, dict[str, dict[str, Any]]] = {}


def _now() -> datetime:
    return datetime.now(UTC)


def _store() -> dict[str, dict[str, dict[str, Any]]]:
    return _miners_by_user


def _ensure_user_bucket(user_id: str) -> dict[str, dict[str, Any]]:
    bucket = _store().get(user_id)
    if bucket is None:
        bucket = {}
        _store()[user_id] = bucket
    return bucket


def _to_response(record: dict[str, Any]) -> UserMinerResponse:
    return UserMinerResponse(
        id=record["id"],
        user_id=record["user_id"],
        name=record["name"],
        hotkey=record["hotkey"],
        netuid=record["netuid"],
        subnet_name=record.get("subnet_name"),
        status=record.get("status", "active"),
        description=record.get("description"),
        tags=record.get("tags", []),
        total_earnings=float(record.get("total_earnings", 0.0)),
        uptime_percent=float(record.get("uptime_percent", 100.0)),
        uid=record.get("uid"),
        incentive=record.get("incentive"),
        created_at=record["created_at"],
        updated_at=record.get("updated_at"),
    )


class UserMinerService:
    """
    Service for managing user-owned miner registrations.

    TODO: replace in-memory dict with a UserMiner SQLAlchemy model + table.
    The current implementation keeps records in a process-local dict keyed by
    user_id; persistence requires the UserMiner model + alembic migration.
    """

    def __init__(self, db: AsyncSession | None = None) -> None:
        self.db = db

    async def list_user_miners(self, user_id: str) -> list[UserMinerResponse]:
        with _store_lock:
            bucket = _store().get(user_id, {})
            return [_to_response(r) for r in bucket.values()]

    async def get_miner(self, user_id: str, miner_id: str) -> UserMinerResponse | None:
        with _store_lock:
            bucket = _store().get(user_id, {})
            record = bucket.get(miner_id)
            if record is None:
                return None
            return _to_response(record)

    async def register_miner(
        self,
        user_id: str,
        data: UserMinerCreate,
        subnet_name: str | None = None,
        uid: int | None = None,
        incentive: float | None = None,
    ) -> UserMinerResponse:
        miner_id = str(uuid.uuid4())
        now = _now()
        record: dict[str, Any] = {
            "id": miner_id,
            "user_id": user_id,
            "name": data.name,
            "hotkey": data.hotkey,
            "netuid": data.netuid,
            "subnet_name": subnet_name,
            "status": "active",
            "description": data.description,
            "tags": list(data.tags or []),
            "total_earnings": 0.0,
            "uptime_percent": 100.0,
            "uid": uid,
            "incentive": incentive,
            "created_at": now,
            "updated_at": now,
        }
        with _store_lock:
            bucket = _ensure_user_bucket(user_id)
            bucket[miner_id] = record
        return _to_response(record)

    async def update_miner(
        self,
        user_id: str,
        miner_id: str,
        data: UserMinerUpdate,
    ) -> UserMinerResponse | None:
        with _store_lock:
            bucket = _store().get(user_id, {})
            record = bucket.get(miner_id)
            if record is None:
                return None
            updates = data.model_dump(exclude_unset=True)
            for field_name, value in updates.items():
                record[field_name] = value
            record["updated_at"] = _now()
            return _to_response(record)

    async def delete_miner(self, user_id: str, miner_id: str) -> bool:
        with _store_lock:
            bucket = _store().get(user_id, {})
            if miner_id not in bucket:
                return False
            del bucket[miner_id]
            if not bucket:
                _store().pop(user_id, None)
            return True

    @staticmethod
    def reset_store() -> None:
        with _store_lock:
            _store().clear()
