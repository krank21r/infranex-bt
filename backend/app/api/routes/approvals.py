"""
HTTP API for the approval queue and the audit log.

Read paths:
  GET  /approvals/pending        - list pending requests for the caller
  GET  /approvals/audit          - read the audit log (read-only by design)
  GET  /approvals/{id}           - fetch a single request

Write paths (require authenticated user):
  POST /approvals/{id}/approve   - mark approved
  POST /approvals/{id}/reject    - mark rejected
  POST /approvals/{id}/cancel    - mark cancelled

L1 actions never reach this API; they are auto-approved at insert time
inside ApprovalService.create and the audit log already has the row.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.approval import ActionLevel, ApprovalService
from app.models.audit import ApprovalRequest, AuditLog
from app.schemas.auth import User
from app.schemas.common import APIResponse, PaginationMeta

router = APIRouter(prefix="/approvals", tags=["approvals"])


class ApprovalOut(BaseModel):
    id: str
    action_type: str
    level: str
    status: str
    requested_by: str
    approved_by: str | None = None
    subject_type: str | None = None
    subject_id: str | None = None
    reason: str | None = None
    risk_score: float | None = None
    expires_at: datetime | None = None
    decided_at: datetime | None = None
    decision_note: str | None = None
    created_at: datetime
    updated_at: datetime


class DecisionIn(BaseModel):
    decision_note: str | None = Field(default=None, max_length=2000)


class AuditOut(BaseModel):
    id: str
    actor: str
    action: str
    target_type: str | None = None
    target_id: str | None = None
    before: dict | None = None
    after: dict | None = None
    reason: str | None = None
    correlation_id: str | None = None
    related_approval_id: str | None = None
    metadata: dict = Field(default_factory=dict)
    created_at: datetime


def _to_out(row: ApprovalRequest) -> ApprovalOut:
    return ApprovalOut(
        id=row.id,
        action_type=row.action_type,
        level=row.level,
        status=row.status,
        requested_by=row.requested_by,
        approved_by=row.approved_by,
        subject_type=row.subject_type,
        subject_id=row.subject_id,
        reason=row.reason,
        risk_score=row.risk_score,
        expires_at=row.expires_at,
        decided_at=row.decided_at,
        decision_note=row.decision_note,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _audit_to_out(row: AuditLog) -> AuditOut:
    return AuditOut(
        id=row.id,
        actor=row.actor,
        action=row.action,
        target_type=row.target_type,
        target_id=row.target_id,
        before=row.before,
        after=row.after,
        reason=row.reason,
        correlation_id=row.correlation_id,
        related_approval_id=row.related_approval_id,
        metadata=row.metadata_ or {},
        created_at=row.created_at,
    )


@router.get("/pending", response_model=APIResponse[list[ApprovalOut]])
async def list_pending(
    level: ActionLevel | None = None,
    limit: int = 50,
    offset: int = 0,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    svc = ApprovalService(session)
    rows = await svc.list_pending(
        requested_by=user.id, level=level, limit=limit, offset=offset
    )
    return APIResponse(success=True, data=[_to_out(r) for r in rows])


@router.get("/audit", response_model=APIResponse[list[AuditOut]])
async def list_audit(
    actor: str | None = None,
    action: str | None = None,
    target_id: str | None = None,
    page: int = 1,
    page_size: int = 50,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    filters = []
    if actor:
        filters.append(AuditLog.actor == actor)
    if action:
        filters.append(AuditLog.action == action)
    if target_id:
        filters.append(AuditLog.target_id == target_id)

    count_q = select(func.count()).select_from(AuditLog)
    for f in filters:
        count_q = count_q.where(f)
    total = (await session.execute(count_q)).scalar_one()

    stmt = select(AuditLog)
    for f in filters:
        stmt = stmt.where(f)
    stmt = stmt.order_by(desc(AuditLog.created_at))
    stmt = stmt.limit(page_size).offset((page - 1) * page_size)
    rows = (await session.execute(stmt)).scalars().all()

    total_pages = max(1, (total + page_size - 1) // page_size)
    meta = PaginationMeta(
        page=page, page_size=page_size, total_items=total,
        total_pages=total_pages, has_next=page < total_pages, has_prev=page > 1,
    )
    return APIResponse(
        success=True,
        data=[_audit_to_out(r) for r in rows],
        meta=meta,
    )


@router.get("/{approval_id}", response_model=APIResponse[ApprovalOut])
async def get_one(
    approval_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    svc = ApprovalService(session)
    row = await svc.get(approval_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="approval_not_found"
        )
    if row.requested_by != user.id and not row.requested_by.startswith("system:"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="not_your_request"
        )
    return APIResponse(success=True, data=_to_out(row))


@router.post("/{approval_id}/approve", response_model=APIResponse[ApprovalOut])
async def approve(
    approval_id: str,
    body: DecisionIn = DecisionIn(),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    svc = ApprovalService(session)
    ok = await svc.decide(
        approval_id=approval_id,
        approver_user_id=user.id,
        approve=True,
        decision_note=body.decision_note,
    )
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="not_pending_or_not_found"
        )
    row = await svc.get(approval_id)
    return APIResponse(success=True, data=_to_out(row))


@router.post("/{approval_id}/reject", response_model=APIResponse[ApprovalOut])
async def reject(
    approval_id: str,
    body: DecisionIn = DecisionIn(),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    svc = ApprovalService(session)
    ok = await svc.decide(
        approval_id=approval_id,
        approver_user_id=user.id,
        approve=False,
        decision_note=body.decision_note,
    )
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="not_pending_or_not_found"
        )
    row = await svc.get(approval_id)
    return APIResponse(success=True, data=_to_out(row))


@router.post("/{approval_id}/cancel", response_model=APIResponse[ApprovalOut])
async def cancel(
    approval_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    svc = ApprovalService(session)
    ok = await svc.cancel(approval_id=approval_id)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="not_pending_or_not_found"
        )
    row = await svc.get(approval_id)
    return APIResponse(success=True, data=_to_out(row))
