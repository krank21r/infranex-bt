"""
Alert engine — scans miners for issues and maintains an in-memory alert store.

Phase scope: in-memory store. The alert payloads are exposed via the
monitoring API; persistence can be added by swapping the store for a
repository without changing the engine contract.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Miner, MinerHealth
from app.monitoring.schemas import (
    Alert,
    AlertType,
    AlertSeverity,
)

logger = logging.getLogger(__name__)

DEFAULT_GPU_UTIL_THRESHOLD = 20.0
DEFAULT_TEMP_THRESHOLD = 85.0
DEFAULT_ROI_LOOKBACK_HOURS = 24


class AlertEngine:
    """Evaluate miner health against alert rules and emit structured alerts."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._store: dict[str, Alert] = {}

    async def check_alerts(self) -> list[Alert]:
        stmt = select(Miner)
        miners = (await self.db.execute(stmt)).scalars().all()

        alerts: list[Alert] = []
        for miner in miners:
            miner_alerts = await self._evaluate_miner(miner)
            alerts.extend(miner_alerts)

        return alerts

    def create_alert(
        self,
        severity: AlertSeverity,
        message: str,
        miner_id: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
        alert_type: Optional[AlertType] = None,
    ) -> Alert:
        alert = Alert(
            id=str(uuid.uuid4()),
            alert_type=alert_type or AlertType.miner_down,
            severity=severity,
            message=message,
            miner_id=miner_id,
            metadata=metadata or {},
        )
        self._store[alert.id] = alert
        return alert

    def resolve_alert(self, alert_id: str) -> Optional[Alert]:
        alert = self._store.get(alert_id)
        if not alert:
            return None
        alert.is_resolved = True
        alert.resolved_at = datetime.now(timezone.utc)
        return alert

    def get_active_alerts(self) -> list[Alert]:
        return [a for a in self._store.values() if not a.is_resolved]

    async def _evaluate_miner(self, miner: Miner) -> list[Alert]:
        alerts: list[Alert] = []

        latest_health_stmt = (
            select(MinerHealth)
            .where(MinerHealth.miner_id == miner.id)
            .order_by(MinerHealth.recorded_at.desc())
            .limit(1)
        )
        latest = (await self.db.execute(latest_health_stmt)).scalar_one_or_none()

        miner_id = str(miner.id)
        now = datetime.now(timezone.utc)
        last_check = miner.last_health_check
        if last_check and last_check.tzinfo is None:
            last_check = last_check.replace(tzinfo=timezone.utc)

        if not latest or not last_check or (now - last_check) > timedelta(minutes=10):
            if miner.status not in ("stopped", "deregistered"):
                alerts.append(
                    Alert(
                        id=str(uuid.uuid4()),
                        alert_type=AlertType.miner_down,
                        severity=AlertSeverity.critical,
                        message=f"Miner {miner_id} has not reported health in >10m",
                        miner_id=miner_id,
                        metadata={"last_check": last_check.isoformat() if last_check else None},
                    )
                )

        if latest:
            if latest.gpu_utilization is not None and latest.gpu_utilization < DEFAULT_GPU_UTIL_THRESHOLD:
                alerts.append(
                    Alert(
                        id=str(uuid.uuid4()),
                        alert_type=AlertType.low_gpu_utilization,
                        severity=AlertSeverity.warning,
                        message=(
                            f"Low GPU utilization on miner {miner_id}: "
                            f"{latest.gpu_utilization:.1f}% < {DEFAULT_GPU_UTIL_THRESHOLD}%"
                        ),
                        miner_id=miner_id,
                        metadata={"gpu_utilization": latest.gpu_utilization},
                    )
                )

            if latest.gpu_temperature is not None and latest.gpu_temperature > DEFAULT_TEMP_THRESHOLD:
                alerts.append(
                    Alert(
                        id=str(uuid.uuid4()),
                        alert_type=AlertType.high_temperature,
                        severity=AlertSeverity.critical,
                        message=(
                            f"High GPU temperature on miner {miner_id}: "
                            f"{latest.gpu_temperature:.1f}C > {DEFAULT_TEMP_THRESHOLD}C"
                        ),
                        miner_id=miner_id,
                        metadata={"gpu_temperature": latest.gpu_temperature},
                    )
                )

            if latest.subnet_connected is False:
                alerts.append(
                    Alert(
                        id=str(uuid.uuid4()),
                        alert_type=AlertType.subnet_disconnected,
                        severity=AlertSeverity.critical,
                        message=f"Subnet disconnected for miner {miner_id} on netuid {miner.netuid}",
                        miner_id=miner_id,
                        metadata={"netuid": miner.netuid},
                    )
                )

            if latest.incentive is not None and latest.incentive < 0:
                alerts.append(
                    Alert(
                        id=str(uuid.uuid4()),
                        alert_type=AlertType.negative_roi,
                        severity=AlertSeverity.warning,
                        message=f"Negative incentive (ROI) detected on miner {miner_id}: {latest.incentive:.4f}",
                        miner_id=miner_id,
                        metadata={"incentive": latest.incentive},
                    )
                )

        for a in alerts:
            self._store.setdefault(a.id, a)

        return alerts
