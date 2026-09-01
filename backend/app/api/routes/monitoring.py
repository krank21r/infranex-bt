"""
Monitoring API routes.

Exposes system overview, per-miner health summaries, alert CRUD,
and an SSE stream for real-time updates.
"""
from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.monitoring.aggregator import MonitoringAggregator
from app.monitoring.alerts import AlertEngine, AlertSeverity
from app.monitoring.realtime import (
    push_alert,
    push_subnet_performance,
    sse_event_stream,
)
from app.monitoring.schemas import (
    Alert,
    MinerHealthSummary,
    SubnetPerformance,
    SystemOverview,
)
from app.schemas.common import APIResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/monitoring", tags=["monitoring"])


@router.get("/overview", response_model=APIResponse[SystemOverview])
async def get_overview(
    db: AsyncSession = Depends(get_db),
) -> APIResponse[SystemOverview]:
    aggregator = MonitoringAggregator(db)
    alert_engine = AlertEngine(db)

    overview = await aggregator.get_system_overview()
    active_alerts = alert_engine.get_active_alerts()

    critical = sum(1 for a in active_alerts if a.severity == AlertSeverity.critical)
    warning = sum(1 for a in active_alerts if a.severity == AlertSeverity.warning)
    info = sum(1 for a in active_alerts if a.severity == AlertSeverity.info)

    overview.total_alerts = len(active_alerts)
    overview.critical_alerts = critical
    overview.warning_alerts = warning
    overview.info_alerts = info
    overview.alerts = active_alerts

    return APIResponse(success=True, data=overview)


@router.get("/miners/{miner_id}", response_model=APIResponse[MinerHealthSummary])
async def get_miner_health(
    miner_id: str,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[MinerHealthSummary]:
    aggregator = MonitoringAggregator(db)
    alert_engine = AlertEngine(db)

    summary = await aggregator.aggregate_miner_health(miner_id)
    active_alerts = [a for a in alert_engine.get_active_alerts() if a.miner_id == miner_id]
    summary.active_alerts = len(active_alerts)

    return APIResponse(success=True, data=summary)


@router.get("/subnets/{netuid}/performance", response_model=APIResponse[SubnetPerformance])
async def get_subnet_performance(
    netuid: int,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[SubnetPerformance]:
    aggregator = MonitoringAggregator(db)
    alert_engine = AlertEngine(db)

    perf = await aggregator.aggregate_subnet_performance(netuid)
    active_alerts = alert_engine.get_active_alerts()
    subnet_alert_count = sum(
        1 for a in active_alerts if a.miner_id and any(m.miner_id == a.miner_id for m in perf.miners)
    )
    perf.active_alerts = subnet_alert_count

    await push_subnet_performance(perf)
    return APIResponse(success=True, data=perf)


@router.get("/alerts", response_model=APIResponse[list[Alert]])
async def list_alerts(
    severity: str | None = Query(None, description="Filter by severity"),
    resolved: bool | None = Query(None, description="Filter by resolved status"),
    db: AsyncSession = Depends(get_db),
) -> APIResponse[list[Alert]]:
    engine = AlertEngine(db)
    alerts = engine.get_active_alerts()

    if severity is not None:
        alerts = [a for a in alerts if a.severity.value == severity]
    if resolved is not None:
        alerts = [a for a in alerts if a.is_resolved == resolved]

    return APIResponse(success=True, data=alerts)


@router.post("/alerts/{alert_id}/resolve", response_model=APIResponse[Alert])
async def resolve_alert(
    alert_id: str,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[Alert]:
    engine = AlertEngine(db)
    alert = engine.resolve_alert(alert_id)
    if not alert:
        raise HTTPException(
            status_code=404,
            detail=f"Alert {alert_id} not found",
        )
    return APIResponse(success=True, data=alert, message="Alert resolved")


@router.post("/alerts/check", response_model=APIResponse[list[Alert]])
async def run_alert_check(
    db: AsyncSession = Depends(get_db),
) -> APIResponse[list[Alert]]:
    engine = AlertEngine(db)
    alerts = await engine.check_alerts()
    for a in alerts:
        await push_alert(a)
    return APIResponse(success=True, data=alerts, message="Alert check completed")


@router.get("/events")
async def stream_events(
    request: Request,
) -> StreamingResponse:
    client_id = str(uuid.uuid4())
    return StreamingResponse(
        sse_event_stream(request, client_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
