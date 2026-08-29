"""
Recovery engine — decides and executes recovery actions.

Decision logic + service-like orchestrator:

  - `decide(miner_id, health_signal) -> RecoveryAction`
    Maps a HealthSignal to the appropriate recovery strategy.
    Uses the L1/L2/L3 classifier to stamp the action level.

  - `execute(recovery_action) -> RecoveryResult`
    Dispatches to the matching strategy and returns the result.

  - `execute_with_approval(recovery_action, approval_id) -> RecoveryResult`
    Checks approval status before dispatching. L1 auto-executes;
    L2/L3 require an approved request or return a pending result.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.approval.classifier import ActionLevel, ActionContext
from app.approval.service import request_approval
from app.models import Miner
from app.models.audit import ApprovalRequest
from app.recovery.health_checker import HealthSignal
from app.recovery.strategies import (
    RecoveryResult,
    restart_process,
    redeploy,
    switch_subnet,
    escalate_to_human,
)

RECOVERY_MODEL_VERSION = "v1.0"


@dataclass(frozen=True)
class RecoveryAction:
    """A recovery action decided by the engine."""
    action_type: str  # "restart_process" | "redeploy" | "switch_subnet" | "escalate_to_human"
    miner_id: str
    reason: str
    action_level: str  # L1_auto | L2_confirm | L3_mandatory
    params: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "action_type": self.action_type,
            "miner_id": self.miner_id,
            "reason": self.reason,
            "action_level": self.action_level,
            "params": self.params,
            "model_version": RECOVERY_MODEL_VERSION,
        }


class RecoveryEngine:
    """Decides and executes recovery actions for unhealthy miners."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def decide(self, miner_id: str, health_signal: HealthSignal) -> RecoveryAction:
        """Map a HealthSignal to a RecoveryAction.

        Decision tree:
          unhealthy + process not running   -> restart_process (L2)
          unhealthy + subnet disconnected   -> restart_process (L2)
          degraded + any soft issue          -> restart_process (L2)
          healthy                            -> escalate_to_human (L3) (unexpected)
        """
        miner = (
            (await self.db.execute(select(Miner).where(Miner.id == miner_id)))
            .scalar_one_or_none()
        )
        if miner is None:
            raise LookupError(f"Miner {miner_id} not found")

        params: Dict[str, Any] = {
            "miner_id": miner_id,
            "deployment_id": miner.deployment_id,
            "netuid": miner.netuid,
            "process_id": miner.process_id,
        }

        if health_signal.status == "unhealthy":
            if not health_signal.process_running:
                action_type = "restart_process"
                reason = "Miner process is not running"
            elif not health_signal.subnet_connected:
                action_type = "restart_process"
                reason = "Subnet connectivity lost"
            else:
                action_type = "restart_process"
                reason = "Unhealthy state detected"
        elif health_signal.status == "degraded":
            action_type = "restart_process"
            reason = "Degraded performance requires intervention"
        else:
            action_type = "escalate_to_human"
            reason = "Unexpected healthy state during recovery request"

        level = (
            ActionLevel.L3_MANDATORY.value
            if action_type == "escalate_to_human"
            else ActionLevel.L2_CONFIRM.value
        )

        return RecoveryAction(
            action_type=action_type,
            miner_id=miner_id,
            reason=reason,
            action_level=level,
            params=params,
        )

    async def execute(self, recovery_action: RecoveryAction) -> RecoveryResult:
        """Dispatch to the matching strategy and return the result."""
        strategy_map = {
            "restart_process": restart_process,
            "redeploy": redeploy,
            "switch_subnet": switch_subnet,
            "escalate_to_human": escalate_to_human,
        }
        strategy = strategy_map.get(recovery_action.action_type)
        if strategy is None:
            return RecoveryResult(
                success=False,
                message=f"Unknown recovery action: {recovery_action.action_type}",
                action_type=recovery_action.action_type,
                action_level=recovery_action.action_level,
                details={"miner_id": recovery_action.miner_id},
                executed_at=datetime.now(timezone.utc).isoformat(),
            )

        payload = {
            "miner_id": recovery_action.miner_id,
            "params": recovery_action.params,
            "reason": recovery_action.reason,
        }
        return await strategy(self.db, payload)

    async def execute_with_approval(
        self, recovery_action: RecoveryAction, approval_id: Optional[str] = None
    ) -> RecoveryResult:
        """Execute a recovery action gated by approval status.

        L1 actions auto-execute. L2/L3 require an approved request.
        If no approval_id is provided, one is created automatically.
        Returns a pending result when approval is not yet granted.
        """
        level = ActionLevel(recovery_action.action_level)

        if level == ActionLevel.L1_AUTO:
            return await self.execute(recovery_action)

        if approval_id is None:
            ctx = ActionContext(
                action_type=recovery_action.action_type,
                is_new_subnet=recovery_action.params.get("is_new_subnet", False),
                is_reversible=recovery_action.params.get("is_reversible", True),
                amount_inr=recovery_action.params.get("amount_inr"),
                risk_score=recovery_action.params.get("risk_score"),
            )
            approval_id, _ = await request_approval(
                self.db,
                ctx,
                requested_by="system:recovery",
                subject_type="miner",
                subject_id=recovery_action.miner_id,
                payload=recovery_action.params,
                reason=recovery_action.reason,
            )

        stmt = select(ApprovalRequest).where(ApprovalRequest.id == approval_id)
        result = await self.db.execute(stmt)
        req = result.scalar_one_or_none()

        if req is None:
            return RecoveryResult(
                success=False,
                message="Approval request not found",
                action_type=recovery_action.action_type,
                action_level=recovery_action.action_level,
                details={"miner_id": recovery_action.miner_id, "approval_id": approval_id},
                executed_at=datetime.now(timezone.utc).isoformat(),
            )

        if req.status == "pending":
            return RecoveryResult(
                success=False,
                message="Approval pending human review",
                action_type=recovery_action.action_type,
                action_level=recovery_action.action_level,
                details={
                    "miner_id": recovery_action.miner_id,
                    "approval_id": approval_id,
                    "approval_status": "pending",
                },
                executed_at=datetime.now(timezone.utc).isoformat(),
            )

        if req.status != "approved":
            return RecoveryResult(
                success=False,
                message=f"Approval {req.status}",
                action_type=recovery_action.action_type,
                action_level=recovery_action.action_level,
                details={
                    "miner_id": recovery_action.miner_id,
                    "approval_id": approval_id,
                    "approval_status": req.status,
                },
                executed_at=datetime.now(timezone.utc).isoformat(),
            )

        return await self.execute(recovery_action)
