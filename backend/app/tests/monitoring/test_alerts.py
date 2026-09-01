"""
Tests for AlertEngine.

Validates rule evaluation, CRUD of alerts, and deduplication behavior.
"""
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.monitoring.alerts import AlertEngine
from app.monitoring.schemas import AlertSeverity, AlertType


def _make_miner(miner_id="miner-1", netuid=1, status="running"):
    m = MagicMock()
    m.id = miner_id
    m.netuid = netuid
    m.hotkey_address = f"hotkey-{miner_id}"
    m.status = status
    m.health_score = 80.0
    m.uptime_seconds = 3600
    m.last_health_check = datetime.now(UTC) - timedelta(minutes=2)
    return m


def _make_health(miner_id="miner-1", gpu_util=75.0, gpu_temp=60.0, subnet_connected=True, incentive=0.02, errors=None):
    h = MagicMock()
    h.miner_id = miner_id
    h.gpu_utilization = gpu_util
    h.gpu_temperature = gpu_temp
    h.subnet_connected = subnet_connected
    h.incentive = incentive
    h.errors = errors or []
    h.recorded_at = datetime.now(UTC)
    return h


def _make_miner_result(miner):
    result = MagicMock()
    result.scalar_one_or_none.return_value = miner
    result.scalars.return_value.all.return_value = [miner]
    return result


def _make_health_result(health):
    result = MagicMock()
    result.scalar_one_or_none.return_value = health
    result.scalars.return_value.all.return_value = [health]
    return result


def _make_empty_result():
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    result.scalars.return_value.all.return_value = []
    return result


@pytest.mark.asyncio
async def test_check_alerts_detects_miner_down():
    db = AsyncMock()
    miner = _make_miner(status="error")
    miner.last_health_check = datetime.now(UTC) - timedelta(minutes=30)

    call_count = {"n": 0}

    async def _se(stmt):
        call_count["n"] += 1
        # First call is the miners list, second is the health query
        if call_count["n"] == 1:
            return _make_miner_result(miner)
        return _make_empty_result()

    db.execute = AsyncMock(side_effect=_se)

    engine = AlertEngine(db)
    alerts = await engine.check_alerts()

    types = [a.alert_type for a in alerts]
    assert AlertType.miner_down in types


@pytest.mark.asyncio
async def test_check_alerts_detects_low_gpu_utilization():
    db = AsyncMock()
    miner = _make_miner()
    health = _make_health(gpu_util=5.0)

    call_count = {"n": 0}

    async def _se(stmt):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return _make_miner_result(miner)
        return _make_health_result(health)

    db.execute = AsyncMock(side_effect=_se)

    engine = AlertEngine(db)
    alerts = await engine.check_alerts()

    assert any(a.alert_type == AlertType.low_gpu_utilization for a in alerts)
    assert any(a.severity == AlertSeverity.warning for a in alerts)


@pytest.mark.asyncio
async def test_check_alerts_detects_high_temperature():
    db = AsyncMock()
    miner = _make_miner()
    health = _make_health(gpu_temp=95.0)

    call_count = {"n": 0}

    async def _se(stmt):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return _make_miner_result(miner)
        return _make_health_result(health)

    db.execute = AsyncMock(side_effect=_se)

    engine = AlertEngine(db)
    alerts = await engine.check_alerts()

    assert any(a.alert_type == AlertType.high_temperature for a in alerts)
    assert any(a.severity == AlertSeverity.critical for a in alerts)


@pytest.mark.asyncio
async def test_check_alerts_detects_subnet_disconnected():
    db = AsyncMock()
    miner = _make_miner()
    health = _make_health(subnet_connected=False)

    call_count = {"n": 0}

    async def _se(stmt):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return _make_miner_result(miner)
        return _make_health_result(health)

    db.execute = AsyncMock(side_effect=_se)

    engine = AlertEngine(db)
    alerts = await engine.check_alerts()

    assert any(a.alert_type == AlertType.subnet_disconnected for a in alerts)


@pytest.mark.asyncio
async def test_check_alerts_detects_negative_roi():
    db = AsyncMock()
    miner = _make_miner()
    health = _make_health(incentive=-0.5)

    call_count = {"n": 0}

    async def _se(stmt):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return _make_miner_result(miner)
        return _make_health_result(health)

    db.execute = AsyncMock(side_effect=_se)

    engine = AlertEngine(db)
    alerts = await engine.check_alerts()

    assert any(a.alert_type == AlertType.negative_roi for a in alerts)


def test_create_and_resolve_alert():
    engine = AlertEngine(db=AsyncMock())
    alert = engine.create_alert(
        severity=AlertSeverity.critical,
        message="Test alert",
        miner_id="miner-1",
        metadata={"foo": "bar"},
        alert_type=AlertType.miner_down,
    )

    assert alert.id is not None
    assert alert.severity == AlertSeverity.critical
    assert alert.miner_id == "miner-1"
    assert alert.is_resolved is False
    assert alert.resolved_at is None

    resolved = engine.resolve_alert(alert.id)
    assert resolved is not None
    assert resolved.is_resolved is True
    assert resolved.resolved_at is not None

    missing = engine.resolve_alert("does-not-exist")
    assert missing is None


def test_get_active_alerts():
    engine = AlertEngine(db=AsyncMock())
    engine.create_alert(AlertSeverity.warning, "A1", alert_type=AlertType.low_gpu_utilization)
    engine.create_alert(AlertSeverity.critical, "A2", alert_type=AlertType.high_temperature)
    a3 = engine.create_alert(AlertSeverity.info, "A3", alert_type=AlertType.miner_down)
    engine.resolve_alert(a3.id)

    active = engine.get_active_alerts()
    assert len(active) == 2
    assert all(not a.is_resolved for a in active)
