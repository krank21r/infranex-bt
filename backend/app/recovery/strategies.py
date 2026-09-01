"""
Recovery strategies.

Pure functions that consume a `RecoveryAction` and return a
`RecoveryResult`. Each strategy performs real DB reads, provider API
calls, and audit logging.

Each strategy maps to an L1/L2/L3 action in the classifier:
  restart_process   -> restart_miner (L2_confirm)
  redeploy          -> recover_container (L2_confirm) or deploy_new_miner (L3)
  switch_subnet     -> switch_subnet_within_roi_band (L2) or migrate_to_new_subnet (L3)
  escalate_to_human -> L3_mandatory (human approval required)
"""
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.approval.audit import AuditWriter
from app.approval.classifier import ActionContext, ActionLevel, classify_action
from app.approval.service import ApprovalRequestInput, ApprovalService
from app.models import Deployment, Miner, Server
from app.providers.registry import get_provider
from app.services.deployment_service import DeploymentService


@dataclass(frozen=True)
class RecoveryResult:
    """Outcome of executing a recovery strategy."""
    success: bool
    message: str
    action_type: str
    action_level: str
    details: dict[str, Any]
    executed_at: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "message": self.message,
            "action_type": self.action_type,
            "action_level": self.action_level,
            "details": self.details,
            "executed_at": self.executed_at,
        }


def _classify_recovery_action(
    action_type: str, params: dict[str, Any]
) -> ActionLevel:
    """Map a recovery action_type to its L1/L2/L3 level."""
    ctx = ActionContext(
        action_type=action_type,
        is_new_subnet=params.get("is_new_subnet", False),
        is_reversible=params.get("is_reversible", True),
        amount_inr=params.get("amount_inr"),
        risk_score=params.get("risk_score"),
    )
    level = classify_action(ctx)
    return level or ActionLevel.L3_MANDATORY


async def _audit_log(db: AsyncSession, *, action: str, miner_id: str, reason: str = "", metadata: dict[str, Any] | None = None) -> None:
    writer = AuditWriter(db)
    await writer.record(
        actor="system:recovery",
        action=action,
        target_type="miner",
        target_id=miner_id,
        reason=reason,
        metadata=metadata or {},
    )


async def restart_process(db: AsyncSession, action: dict[str, Any]) -> RecoveryResult:
    """Strategy: restart the miner process."""
    params = action.get("params", {})
    deployment_id = params.get("deployment_id")
    miner_id = action.get("miner_id")
    level = _classify_recovery_action("restart_miner", params)

    deployment = await db.get(Deployment, deployment_id)
    if deployment is None:
        return RecoveryResult(
            success=False,
            message=f"Deployment {deployment_id} not found",
            action_type="restart_miner",
            action_level=level.value,
            details={"miner_id": miner_id, "deployment_id": deployment_id},
            executed_at=datetime.now(UTC).isoformat(),
        )

    server = None
    if deployment.server_id:
        server = await db.get(Server, deployment.server_id)

    provider = get_provider()

    if server:
        provider.stop_miner(server)

    new_server = await provider.provision_server(deployment)
    db.add(new_server)
    deployment.server_id = new_server.id
    await db.flush()

    await _audit_log(
        db,
        action="restart_process",
        miner_id=miner_id,
        reason=action.get("reason"),
        metadata={"deployment_id": deployment_id, "new_server_id": new_server.id},
    )

    return RecoveryResult(
        success=True,
        message=f"Restarted miner {miner_id} on new server {new_server.provider_instance_id}",
        action_type="restart_miner",
        action_level=level.value,
        details={
            "miner_id": miner_id,
            "deployment_id": deployment_id,
            "old_server_id": server.id if server else None,
            "new_server_id": new_server.id,
            "new_provider_instance_id": new_server.provider_instance_id,
        },
        executed_at=datetime.now(UTC).isoformat(),
    )


async def redeploy(db: AsyncSession, action: dict[str, Any]) -> RecoveryResult:
    """Strategy: redeploy the miner (new container / instance)."""
    params = action.get("params", {})
    deployment_id = params.get("deployment_id")
    miner_id = action.get("miner_id")
    is_new = params.get("is_new_deployment", False)
    action_type = "deploy_new_miner" if is_new else "recover_container"
    level = _classify_recovery_action(action_type, params)

    deployment = await db.get(Deployment, deployment_id)
    if deployment is None:
        return RecoveryResult(
            success=False,
            message=f"Deployment {deployment_id} not found",
            action_type=action_type,
            action_level=level.value,
            details={"miner_id": miner_id, "deployment_id": deployment_id},
            executed_at=datetime.now(UTC).isoformat(),
        )

    deployment_service = DeploymentService(db)
    try:
        updated = await deployment_service.redeploy_miner(deployment_id)
    except Exception as exc:
        return RecoveryResult(
            success=False,
            message=f"Redeploy failed: {exc}",
            action_type=action_type,
            action_level=level.value,
            details={
                "miner_id": miner_id,
                "deployment_id": deployment_id,
                "error": str(exc),
            },
            executed_at=datetime.now(UTC).isoformat(),
        )

    await _audit_log(
        db,
        action="redeploy",
        miner_id=miner_id,
        reason=action.get("reason"),
        metadata={
            "deployment_id": deployment_id,
            "is_new_deployment": is_new,
            "final_status": updated.status,
            "server_id": updated.server_id,
        },
    )

    return RecoveryResult(
        success=True,
        message=f"Redeployed miner {miner_id} to status {updated.status}",
        action_type=action_type,
        action_level=level.value,
        details={
            "miner_id": miner_id,
            "deployment_id": deployment_id,
            "final_status": updated.status,
            "server_id": updated.server_id,
        },
        executed_at=datetime.now(UTC).isoformat(),
    )


async def switch_subnet(db: AsyncSession, action: dict[str, Any]) -> RecoveryResult:
    """Strategy: switch miner to an alternative subnet."""
    params = action.get("params", {})
    miner_id = action.get("miner_id")
    target_netuid = params.get("target_netuid")
    is_new = params.get("is_new_subnet", False)
    action_type = (
        "migrate_to_new_subnet" if is_new else "switch_subnet_within_roi_band"
    )
    level = _classify_recovery_action(action_type, params)

    miner = await db.get(Miner, miner_id)
    if miner is None:
        return RecoveryResult(
            success=False,
            message=f"Miner {miner_id} not found",
            action_type=action_type,
            action_level=level.value,
            details={"miner_id": miner_id, "target_netuid": target_netuid},
            executed_at=datetime.now(UTC).isoformat(),
        )

    deployment = None
    server = None
    if miner.deployment_id:
        deployment = await db.get(Deployment, miner.deployment_id)
        if deployment and deployment.server_id:
            server = await db.get(Server, deployment.server_id)

    old_netuid = miner.netuid
    miner.netuid = target_netuid
    if deployment:
        deployment.netuid = target_netuid
    await db.flush()

    if server:
        provider = get_provider()
        provider.stop_miner(server)
        if deployment:
            new_server = await provider.provision_server(deployment)
            db.add(new_server)
            deployment.server_id = new_server.id
            await db.flush()

    await _audit_log(
        db,
        action="switch_subnet",
        miner_id=miner_id,
        reason=action.get("reason"),
        metadata={
            "old_netuid": old_netuid,
            "target_netuid": target_netuid,
            "deployment_id": miner.deployment_id,
        },
    )

    return RecoveryResult(
        success=True,
        message=f"Switched miner {miner_id} from subnet {old_netuid} to {target_netuid}",
        action_type=action_type,
        action_level=level.value,
        details={
            "miner_id": miner_id,
            "old_netuid": old_netuid,
            "target_netuid": target_netuid,
            "deployment_id": miner.deployment_id,
        },
        executed_at=datetime.now(UTC).isoformat(),
    )


async def escalate_to_human(db: AsyncSession, action: dict[str, Any]) -> RecoveryResult:
    """Strategy: escalate to human operator."""
    miner_id = action.get("miner_id")
    reason = action.get("reason", "")
    params = action.get("params", {})

    ctx = ActionContext(
        action_type="escalate_to_human",
        is_new_subnet=params.get("is_new_subnet", False),
        is_reversible=params.get("is_reversible", True),
        amount_inr=params.get("amount_inr"),
        risk_score=params.get("risk_score"),
    )
    level = classify_action(ctx) or ActionLevel.L3_MANDATORY

    svc = ApprovalService(db)
    approval_id = await svc.create(
        ApprovalRequestInput(
            action_type="escalate_to_human",
            level=level,
            requested_by="system:recovery",
            subject_type="miner",
            subject_id=miner_id,
            payload=action,
            reason=reason,
        )
    )

    await _audit_log(
        db,
        action="escalate_to_human",
        miner_id=miner_id,
        reason=reason,
        metadata={
            "approval_id": approval_id,
            "health_signal": action.get("health_signal", {}),
        },
    )

    return RecoveryResult(
        success=True,
        message=f"Recovery escalated to human for miner {miner_id}",
        action_type="escalate_to_human",
        action_level=level.value,
        details={
            "miner_id": miner_id,
            "reason": reason,
            "health_signal": action.get("health_signal", {}),
            "approval_id": approval_id,
        },
        executed_at=datetime.now(UTC).isoformat(),
    )
