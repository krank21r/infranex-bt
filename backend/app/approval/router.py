"""
ApprovalRouter - the central gate every consequential engine call passes through.

Workflow:

  engine -> router.request(ctx, ...) ->
      1. Classify (L1/L2/L3)
      2. Insert approval row (auto_approved for L1, pending for L2/L3)
      3. If L1, execute immediately and audit
      4. If L2/L3, return to the caller; the caller is expected to wait
         for a human decision via the API and re-invoke router.execute().

This keeps the policy decision (what level) and the execution decision
(when to run) in one place, so every engine behaves the same way.
"""
import inspect
from dataclasses import dataclass
from typing import Optional, Awaitable, Callable, Any

from sqlalchemy.ext.asyncio import AsyncSession

from .classifier import ActionContext, ActionLevel, classify_action
from .service import ApprovalService, ApprovalRequestInput
from .audit import AuditWriter


@dataclass
class ApprovalResult:
    approval_id: str
    level: ActionLevel
    executed: bool
    output: Any = None
    error: Optional[str] = None


ActionCallable = Callable[..., Awaitable[Any]]


class ApprovalRouter:
    """Classify -> persist -> optionally execute."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._approvals = ApprovalService(session)
        self._audit = AuditWriter(session)

    async def request(
        self,
        ctx: ActionContext,
        *,
        requested_by: str,
        subject_type: Optional[str] = None,
        subject_id: Optional[str] = None,
        reason: Optional[str] = None,
        action: Optional[ActionCallable] = None,
        action_kwargs: Optional[dict] = None,
    ) -> ApprovalResult:
        level = classify_action(ctx) or ActionLevel.L3_MANDATORY

        approval_id = await self._approvals.create(
            ApprovalRequestInput(
                action_type=ctx.action_type,
                level=level,
                requested_by=requested_by,
                subject_type=subject_type,
                subject_id=subject_id,
                payload={},
                reason=reason,
                risk_score=ctx.risk_score,
            )
        )

        if level != ActionLevel.L1_AUTO:
            return ApprovalResult(
                approval_id=approval_id,
                level=level,
                executed=False,
            )

        if action is None:
            return ApprovalResult(
                approval_id=approval_id,
                level=level,
                executed=True,
            )

        return await self._execute(
            approval_id=approval_id,
            level=level,
            subject_type=subject_type,
            subject_id=subject_id,
            action=action,
            action_kwargs=action_kwargs or {},
        )

    async def execute(
        self,
        *,
        approval_id: str,
        action: ActionCallable,
        action_kwargs: Optional[dict] = None,
    ) -> ApprovalResult:
        row = await self._approvals.get(approval_id)
        if row is None:
            return ApprovalResult(
                approval_id=approval_id,
                level=ActionLevel.L3_MANDATORY,
                executed=False,
                error="approval_not_found",
            )
        if row.status != "approved":
            return ApprovalResult(
                approval_id=approval_id,
                level=ActionLevel(row.level),
                executed=False,
                error=f"approval_not_decided:{row.status}",
            )
        return await self._execute(
            approval_id=approval_id,
            level=ActionLevel(row.level),
            subject_type=row.subject_type,
            subject_id=row.subject_id,
            action=action,
            action_kwargs=action_kwargs or {},
        )

    async def _execute(
        self,
        *,
        approval_id: str,
        level: ActionLevel,
        subject_type: Optional[str],
        subject_id: Optional[str],
        action: ActionCallable,
        action_kwargs: dict,
    ) -> ApprovalResult:
        await self._audit.record(
            actor="system:decision",
            action="approval_executed",
            target_type=subject_type,
            target_id=subject_id,
            related_approval_id=approval_id,
            metadata={"level": level.value},
        )
        try:
            result = await action(**action_kwargs) if action_kwargs else await action()
        except Exception as exc:
            await self._audit.record(
                actor="system:decision",
                action="approval_execution_failed",
                target_type=subject_type,
                target_id=subject_id,
                related_approval_id=approval_id,
                reason=str(exc),
            )
            return ApprovalResult(
                approval_id=approval_id,
                level=level,
                executed=False,
                error=str(exc),
            )
        if inspect.isawaitable(result):
            result = await result
        return ApprovalResult(
            approval_id=approval_id,
            level=level,
            executed=True,
            output=result,
        )
