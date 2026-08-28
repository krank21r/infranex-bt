"""
ApprovalService - persistence layer for the approval_requests table.

This service is intentionally thin. Its job is:
  1. Insert a new approval request (called by the Decision Engine, the
     Drift Engine, the Deployment Engine, etc.).
  2. Look up pending / approved / rejected requests for the API.
  3. Apply a human decision (approve / reject / cancel) to a row,
     stamping who decided, when, and (optionally) why.

L1 actions are still inserted (with status='auto_approved') so the
audit trail captures every action Infranex took, not just the ones
that needed a human. This is by design - see the migration 002
COMMENT on approval_requests.
"""
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from sqlalchemy import select, update, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import ApprovalRequest
from .classifier import ActionLevel, ActionContext, classify_action


@dataclass
class ApprovalRequestInput:
    action_type: str
    level: ActionLevel
    requested_by: str
    subject_type: Optional[str] = None
    subject_id: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None
    reason: Optional[str] = None
    risk_score: Optional[float] = None
    expires_at: Optional[datetime] = None


class ApprovalService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(self, req: ApprovalRequestInput) -> str:
        """Insert a new request. L1 actions are immediately auto_approved."""
        row_id = str(uuid.uuid4())
        initial_status = (
            "auto_approved" if req.level == ActionLevel.L1_AUTO else "pending"
        )
        decided_at = (
            datetime.now(timezone.utc) if req.level == ActionLevel.L1_AUTO else None
        )
        await self._session.execute(
            insert(ApprovalRequest).values(
                id=row_id,
                action_type=req.action_type,
                level=req.level.value,
                status=initial_status,
                requested_by=req.requested_by,
                subject_type=req.subject_type,
                subject_id=req.subject_id,
                payload=req.payload or {},
                reason=req.reason,
                risk_score=req.risk_score,
                expires_at=req.expires_at,
                decided_at=decided_at,
            )
        )
        await self._session.commit()
        return row_id

    async def list_pending(
        self,
        *,
        requested_by: Optional[str] = None,
        level: Optional[ActionLevel] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[ApprovalRequest]:
        stmt = select(ApprovalRequest).where(ApprovalRequest.status == "pending")
        if requested_by is not None:
            stmt = stmt.where(ApprovalRequest.requested_by == requested_by)
        if level is not None:
            stmt = stmt.where(ApprovalRequest.level == level.value)
        stmt = (
            stmt.order_by(ApprovalRequest.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def get(self, approval_id: str) -> Optional[ApprovalRequest]:
        result = await self._session.execute(
            select(ApprovalRequest).where(ApprovalRequest.id == approval_id)
        )
        return result.scalar_one_or_none()

    async def decide(
        self,
        *,
        approval_id: str,
        approver_user_id: str,
        approve: bool,
        decision_note: Optional[str] = None,
    ) -> bool:
        """Apply a human decision. Returns True if the row was updated."""
        new_status = "approved" if approve else "rejected"
        result = await self._session.execute(
            update(ApprovalRequest)
            .where(
                and_(
                    ApprovalRequest.id == approval_id,
                    ApprovalRequest.status == "pending",
                )
            )
            .values(
                status=new_status,
                approved_by=approver_user_id,
                decided_at=datetime.now(timezone.utc),
                decision_note=decision_note,
            )
        )
        await self._session.commit()
        return result.rowcount > 0

    async def cancel(self, *, approval_id: str) -> bool:
        result = await self._session.execute(
            update(ApprovalRequest)
            .where(
                and_(
                    ApprovalRequest.id == approval_id,
                    ApprovalRequest.status == "pending",
                )
            )
            .values(
                status="cancelled",
                decided_at=datetime.now(timezone.utc),
            )
        )
        await self._session.commit()
        return result.rowcount > 0


# Convenience helper used by engines that don't want to repeat the
# "classify then create" pattern.
async def request_approval(
    session: AsyncSession,
    ctx: ActionContext,
    *,
    requested_by: str,
    subject_type: Optional[str] = None,
    subject_id: Optional[str] = None,
    payload: Optional[Dict[str, Any]] = None,
    reason: Optional[str] = None,
    expires_at: Optional[datetime] = None,
) -> tuple[str, ActionLevel]:
    """Classify the action and insert the request in one call.

    Returns (approval_id, level). Unknown action_types are escalated
    to L3_mandatory (safe default per architecture spec).
    """
    level = classify_action(ctx)
    if level is None:
        level = ActionLevel.L3_MANDATORY
    svc = ApprovalService(session)
    approval_id = await svc.create(
        ApprovalRequestInput(
            action_type=ctx.action_type,
            level=level,
            requested_by=requested_by,
            subject_type=subject_type,
            subject_id=subject_id,
            payload=payload,
            reason=reason,
            risk_score=ctx.risk_score,
            expires_at=expires_at,
        )
    )
    return approval_id, level
