"""
Change detection service — thin orchestration over pure logic.

Fetches current subnet state from DB, compares against baseline
(SubnetVersion), persists detected changes, logs to audit trail,
and raises approval requests for critical shifts.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.approval.audit import AuditWriter
from app.approval.classifier import ActionLevel
from app.approval.service import ApprovalRequestInput, ApprovalService
from app.intelligence.change_detection import (
    ChangeDetectionResult,
    detect_subnet_changes,
    should_raise_approval,
    should_trigger_rescore,
)
from app.models import (
    Deployment,
    MarketData,
    Subnet,
    SubnetMetrics,
    SubnetRequirement,
    SubnetVersion,
)
from app.models.audit import SubnetChange

logger = logging.getLogger(__name__)


class ChangeDetectionService:
    """Detect and persist subnet state changes."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def detect_for_subnet(
        self,
        netuid: int,
        source: str = "scanner",
    ) -> ChangeDetectionResult:
        """Detect changes for a single subnet.

        Fetches the latest baseline (SubnetVersion), compares against
        current state, persists changes, and raises approvals if needed.
        """
        baseline = await self._get_baseline(netuid)
        current = await self._get_current_state(netuid)

        result = detect_subnet_changes(
            netuid=netuid,
            old_state=baseline,
            new_state=current,
        )

        if result.changes:
            await self._persist_changes(result, source)
            await self._audit_log(result)

            if should_trigger_rescore(result):
                logger.info(
                    "change_detection_rescore_triggered",
                    netuid=netuid,
                    highest_impact=result.highest_impact,
                )

            if should_raise_approval(result):
                await self._raise_approval(result)

        return result

    async def detect_for_all(
        self,
        netuids: List[int],
        source: str = "scanner",
    ) -> List[ChangeDetectionResult]:
        """Detect changes for multiple subnets."""
        results: List[ChangeDetectionResult] = []
        for netuid in netuids:
            try:
                result = await self.detect_for_subnet(netuid, source)
                results.append(result)
            except Exception as exc:
                logger.warning(
                    "change_detection_failed netuid=%s error=%s",
                    netuid,
                    str(exc),
                )
        return results

    async def _get_baseline(self, netuid: int) -> Dict[str, Any]:
        """Fetch the last known baseline snapshot from SubnetVersion."""
        stmt = (
            select(SubnetVersion)
            .where(SubnetVersion.netuid == netuid)
            .order_by(SubnetVersion.recorded_at.desc())
            .limit(1)
        )
        result = await self.db.execute(stmt)
        version = result.scalar_one_or_none()

        subnet_stmt = select(Subnet).where(Subnet.netuid == netuid)
        subnet_result = await self.db.execute(subnet_stmt)
        subnet = subnet_result.scalar_one_or_none()

        if version is None:
            metrics = {}
        else:
            metrics = {}

        if subnet:
            metrics["registration_open"] = subnet.registration_open

        return {
            "metrics": metrics,
            "market": {},
            "requirements": version.requirements if version and version.requirements else {},
            "recorded_at": version.recorded_at.isoformat() if version and version.recorded_at else None,
        }

    async def _get_current_state(self, netuid: int) -> Dict[str, Any]:
        """Fetch current subnet state from latest metrics, market, requirements."""
        subnet_stmt = select(Subnet).where(Subnet.netuid == netuid)
        subnet_result = await self.db.execute(subnet_stmt)
        subnet = subnet_result.scalar_one_or_none()

        metrics_stmt = (
            select(SubnetMetrics)
            .where(SubnetMetrics.netuid == netuid)
            .order_by(SubnetMetrics.recorded_at.desc())
            .limit(1)
        )
        metrics_result = await self.db.execute(metrics_stmt)
        latest_metrics = metrics_result.scalar_one_or_none()

        market_stmt = (
            select(MarketData)
            .where(MarketData.netuid == netuid)
            .order_by(MarketData.recorded_at.desc())
            .limit(1)
        )
        market_result = await self.db.execute(market_stmt)
        latest_market = market_result.scalar_one_or_none()

        req_stmt = (
            select(SubnetRequirement)
            .where(SubnetRequirement.netuid == netuid)
            .limit(1)
        )
        req_result = await self.db.execute(req_stmt)
        latest_req = req_result.scalar_one_or_none()

        metrics_dict = _metrics_to_dict(latest_metrics) if latest_metrics else {}
        if subnet:
            metrics_dict["registration_open"] = subnet.registration_open

        return {
            "metrics": metrics_dict,
            "market": _market_to_dict(latest_market) if latest_market else {},
            "requirements": _requirements_to_dict(latest_req) if latest_req else {},
        }

    async def _persist_changes(
        self,
        result: ChangeDetectionResult,
        source: str,
    ) -> None:
        """Write detected changes to subnet_changes table."""
        affected = await self._get_affected_miners(result.netuid)

        for change in result.changes:
            row = SubnetChange(
                netuid=result.netuid,
                change_type=change.change_type,
                old_value={"value": change.old_value},
                new_value={"value": change.new_value},
                impact=change.impact,
                affected_miners=affected,
                source=source,
                notes=(
                    f"{change.field}: {change.old_value} -> {change.new_value} "
                    f"(shift: {change.shift_ratio:.1%})"
                ),
            )
            self.db.add(row)

        await self.db.flush()

    async def _audit_log(self, result: ChangeDetectionResult) -> None:
        """Log detection results to the audit trail."""
        writer = AuditWriter(self.db)
        for change in result.changes:
            await writer.record(
                actor="system:drift",
                action="change_detected",
                target_type="subnet",
                target_id=str(result.netuid),
                before={"value": change.old_value},
                after={"value": change.new_value},
                metadata={
                    "change_type": change.change_type,
                    "field": change.field,
                    "shift_ratio": change.shift_ratio,
                    "impact": change.impact,
                },
            )

    async def _raise_approval(self, result: ChangeDetectionResult) -> None:
        """Raise an approval request for critical changes."""
        svc = ApprovalService(self.db)
        critical_changes = [c for c in result.changes if c.impact == "critical"]
        await svc.create(
            ApprovalRequestInput(
                action_type="approve_drift_correction",
                level=ActionLevel.L2_CONFIRM,
                requested_by="system:drift",
                subject_type="subnet",
                subject_id=str(result.netuid),
                payload={
                    "netuid": result.netuid,
                    "changes": [
                        {
                            "type": c.change_type,
                            "field": c.field,
                            "old": c.old_value,
                            "new": c.new_value,
                        }
                        for c in critical_changes
                    ],
                },
                reason=(
                    f"Critical subnet change detected: "
                    f"{len(critical_changes)} field(s) shifted significantly"
                ),
            )
        )

    async def _get_affected_miners(self, netuid: int) -> List[str]:
        """Get deployment IDs for miners running on this subnet."""
        stmt = select(Deployment.id).where(
            Deployment.netuid == netuid,
            Deployment.status.in_(("started", "provisioned")),
        )
        result = await self.db.execute(stmt)
        return [str(row) for row in result.scalars().all()]


def _metrics_to_dict(m: SubnetMetrics) -> Dict[str, Any]:
    return {
        "emission": m.emission,
        "average_incentive": m.average_incentive,
        "total_stake": m.total_stake,
        "top_5_concentration": m.top_5_concentration,
        "top_10_concentration": m.top_10_concentration,
        "miner_turnover": m.miner_turnover,
        "neuron_utilization": m.neuron_utilization,
        "trust": m.trust,
        "consensus": m.consensus,
        "registration_cost": m.registration_cost,
        "registration_open": m.registration_open,
        "miner_count": m.miner_count,
        "validator_count": m.validator_count,
    }


def _market_to_dict(m: MarketData) -> Dict[str, Any]:
    return {
        "alpha_price_1d_change": m.alpha_price_1d_change,
        "liquidity": m.liquidity,
        "volume_market_cap_ratio": m.volume_market_cap_ratio,
        "tao_price_usd": m.tao_price_usd,
        "tao_price_inr": m.tao_price_inr,
    }


def _requirements_to_dict(r: SubnetRequirement) -> Dict[str, Any]:
    return {
        "min_vram_gb": r.min_vram_gb,
        "recommended_gpu": r.recommended_gpu,
        "cuda_version": r.cuda_version,
        "pytorch_version": r.pytorch_version,
        "ram_gb": r.ram_gb,
        "cpu_cores": r.cpu_cores,
        "storage_gb": r.storage_gb,
        "docker_required": r.docker_required,
        "nvidia_runtime_required": r.nvidia_runtime_required,
        "startup_command": r.startup_command,
        "miner_command": r.miner_command,
    }
