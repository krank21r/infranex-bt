"""
Audit writer - thin wrapper over the audit_logs table.

The audit log is the tamper-evident record of what Infranex BT detected,
what it recommended, what the user approved, and what actually changed
on the server. It is the third pillar of the product.

Design constraints:
  - Inserts are service-role only (see RLS in migration 002).
  - Every record carries an `actor` string (system:discovery |
    system:decision | system:deployment | user:<uuid>), an `action`,
    and optional before/after JSONB snapshots.
  - correlation_id chains multi-step actions (deploy -> start ->
    verify) so the user can replay one logical action in the UI.
  - related_approval_id links the audit row to the approval row that
    authorized it. This is the bridge between pillar 1 and pillar 2.
"""
import uuid
from typing import Any

from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog

ACTOR_SYSTEM_DISCOVERY = "system:discovery"
ACTOR_SYSTEM_DECISION = "system:decision"
ACTOR_SYSTEM_DEPLOYMENT = "system:deployment"
ACTOR_SYSTEM_DRIFT = "system:drift"
ACTOR_SYSTEM_REWARDS = "system:rewards"


class AuditWriter:
    """Insert-only interface to audit_logs."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def record(
        self,
        *,
        actor: str,
        action: str,
        target_type: str | None = None,
        target_id: str | None = None,
        before: dict[str, Any] | None = None,
        after: dict[str, Any] | None = None,
        reason: str | None = None,
        correlation_id: str | None = None,
        related_approval_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        row_id = str(uuid.uuid4())
        await self._session.execute(
            insert(AuditLog).values(
                id=row_id,
                actor=actor,
                action=action,
                target_type=target_type,
                target_id=target_id,
                before=before,
                after=after,
                reason=reason,
                correlation_id=correlation_id,
                related_approval_id=related_approval_id,
                metadata_=metadata or {},
            )
        )
        await self._session.commit()
        return row_id
