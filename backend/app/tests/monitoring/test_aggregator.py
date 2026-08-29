"""
Tests for MonitoringAggregator.

Uses AsyncMock for DB interactions to keep tests fast and deterministic.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock
from datetime import datetime, timezone

from app.monitoring.aggregator import MonitoringAggregator


def _make_miner(miner_id="miner-1", netuid=1, status="running", health_score=85.0, uptime=3600):
    m = MagicMock()
    m.id = miner_id
    m.netuid = netuid
    m.hotkey_address = f"hotkey-{miner_id}"
    m.status = status
    m.health_score = health_score
    m.uptime_seconds = uptime
    m.last_health_check = datetime.now(timezone.utc)
    return m


def _make_health(miner_id="miner-1", gpu_util=75.0, gpu_temp=60.0, emission=0.5, incentive=0.02, rank=0.8, trust=0.9, errors=None, minutes_ago=5):
    h = MagicMock()
    h.miner_id = miner_id
    h.gpu_utilization = gpu_util
    h.gpu_temperature = gpu_temp
    h.gpu_memory_utilization = 50.0
    h.gpu_power_draw = 200.0
    h.cpu_usage = 30.0
    h.ram_usage = 40.0
    h.disk_usage = 20.0
    h.network_rx_mbps = 10.0
    h.network_tx_mbps = 5.0
    h.miner_process_running = True
    h.subnet_connected = True
    h.emission = emission
    h.incentive = incentive
    h.rank = rank
    h.trust = trust
    h.health_score = 80.0
    h.errors = errors or []
    h.recorded_at = datetime.now(timezone.utc)
    return h


def _make_result(scalar=None, scalars_list=None):
    """Build a mock result that supports both scalar_one_or_none() and scalars().all()."""
    result = MagicMock()
    result.scalar_one_or_none.return_value = scalar
    scalars_mock = MagicMock()
    scalars_mock.all.return_value = scalars_list if scalars_list is not None else []
    result.scalars.return_value = scalars_mock
    return result


@pytest.mark.asyncio
async def test_aggregate_miner_health_happy_path():
    db = AsyncMock()
    miner = _make_miner()
    health = _make_health()

    # Queue of results to return in order
    results = [
        _make_result(scalar=miner),           # miner lookup
        _make_result(scalar=health),          # latest health
        _make_result(scalars_list=[health]),  # health history
    ]
    idx = {"n": 0}

    async def _se(stmt):
        r = results[idx["n"]]
        idx["n"] += 1
        return r

    db.execute = AsyncMock(side_effect=_se)

    aggregator = MonitoringAggregator(db)
    summary = await aggregator.aggregate_miner_health("miner-1")

    assert summary.miner_id == "miner-1"
    assert summary.netuid == 1
    assert summary.status == "running"
    assert summary.health_score == 85.0
    assert summary.gpu_utilization_avg == 75.0
    assert summary.gpu_temperature_avg == 60.0
    assert summary.emission == 0.5
    assert summary.incentive == 0.02


@pytest.mark.asyncio
async def test_aggregate_miner_health_unknown_miner_returns_empty():
    db = AsyncMock()

    async def _se(stmt):
        return _make_result(scalar=None)

    db.execute = AsyncMock(side_effect=_se)

    aggregator = MonitoringAggregator(db)
    summary = await aggregator.aggregate_miner_health("missing-id")

    assert summary.miner_id == "missing-id"
    assert summary.status == "unknown"
    assert summary.netuid == 0


@pytest.mark.asyncio
async def test_aggregate_subnet_performance():
    db = AsyncMock()
    miner = _make_miner(miner_id="m1", netuid=3)
    health = _make_health(miner_id="m1")

    # Queue: miner list, then for each miner: miner lookup, latest health, history
    results = [
        _make_result(scalars_list=[miner]),   # all miners in subnet
        _make_result(scalar=miner),           # per-miner: miner lookup
        _make_result(scalar=health),          # per-miner: latest health
        _make_result(scalars_list=[health]),  # per-miner: health history
    ]
    idx = {"n": 0}

    async def _se(stmt):
        r = results[idx["n"]]
        idx["n"] += 1
        return r

    db.execute = AsyncMock(side_effect=_se)

    aggregator = MonitoringAggregator(db)
    perf = await aggregator.aggregate_subnet_performance(3)

    assert perf.netuid == 3
    assert perf.miner_count == 1
    assert perf.active_miners == 1
    assert perf.down_miners == 0
    assert perf.avg_health_score == 85.0


@pytest.mark.asyncio
async def test_get_system_overview():
    db = AsyncMock()
    miner = _make_miner(miner_id="m1")

    # Queue: all miners list, then for each miner: health query (empty)
    results = [
        _make_result(scalars_list=[miner]),   # all miners
        _make_result(scalar=None),            # per-miner: health (no data)
    ]
    idx = {"n": 0}

    async def _se(stmt):
        r = results[idx["n"]]
        idx["n"] += 1
        return r

    db.execute = AsyncMock(side_effect=_se)

    aggregator = MonitoringAggregator(db)
    overview = await aggregator.get_system_overview()

    assert overview.total_miners == 1
    assert overview.active_miners == 1
    assert overview.total_subnets == 1
