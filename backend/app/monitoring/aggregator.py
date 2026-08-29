"""
Monitoring aggregator — pulls raw telemetry from the DB and produces
human-readable summaries for the dashboard and alert engine.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Miner, MinerHealth
from app.monitoring.schemas import (
    MinerHealthSummary,
    SubnetPerformance,
    SystemOverview,
)

logger = logging.getLogger(__name__)


class MonitoringAggregator:
    """Aggregate miner and subnet telemetry into dashboard-ready summaries."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def aggregate_miner_health(self, miner_id: str) -> MinerHealthSummary:
        stmt = select(Miner).where(Miner.id == miner_id)
        miner = (await self.db.execute(stmt)).scalar_one_or_none()
        if not miner:
            return MinerHealthSummary(miner_id=miner_id, status="unknown", netuid=0, hotkey_address="")

        latest_health_stmt = (
            select(MinerHealth)
            .where(MinerHealth.miner_id == miner_id)
            .order_by(MinerHealth.recorded_at.desc())
            .limit(1)
        )
        latest_health = (await self.db.execute(latest_health_stmt)).scalar_one_or_none()

        history_stmt = (
            select(MinerHealth)
            .where(MinerHealth.miner_id == miner_id)
            .order_by(MinerHealth.recorded_at.desc())
            .limit(24)
        )
        history = (await self.db.execute(history_stmt)).scalars().all()

        gpu_utils = [h.gpu_utilization for h in history if h.gpu_utilization is not None]
        gpu_temps = [h.gpu_temperature for h in history if h.gpu_temperature is not None]

        latest_gpu = {}
        if latest_health:
            latest_gpu = {
                "gpu_utilization": latest_health.gpu_utilization,
                "gpu_temperature": latest_health.gpu_temperature,
                "gpu_memory_utilization": latest_health.gpu_memory_utilization,
                "gpu_power_draw": latest_health.gpu_power_draw,
                "cpu_usage": latest_health.cpu_usage,
                "ram_usage": latest_health.ram_usage,
                "disk_usage": latest_health.disk_usage,
                "network_rx_mbps": latest_health.network_rx_mbps,
                "network_tx_mbps": latest_health.network_tx_mbps,
                "miner_process_running": latest_health.miner_process_running,
                "subnet_connected": latest_health.subnet_connected,
            }

        return MinerHealthSummary(
            miner_id=str(miner.id),
            status=miner.status or "unknown",
            netuid=miner.netuid,
            hotkey_address=miner.hotkey_address,
            health_score=miner.health_score,
            uptime_seconds=miner.uptime_seconds,
            last_health_check=miner.last_health_check,
            latest_gpu=latest_gpu,
            gpu_utilization_avg=sum(gpu_utils) / len(gpu_utils) if gpu_utils else None,
            gpu_temperature_avg=sum(gpu_temps) / len(gpu_temps) if gpu_temps else None,
            emission=latest_health.emission if latest_health else None,
            incentive=latest_health.incentive if latest_health else None,
            rank=latest_health.rank if latest_health else None,
            trust=latest_health.trust if latest_health else None,
            recent_errors=latest_health.errors if latest_health and latest_health.errors else [],
        )

    async def aggregate_subnet_performance(self, netuid: int) -> SubnetPerformance:
        miners_stmt = select(Miner).where(Miner.netuid == netuid)
        miners = (await self.db.execute(miners_stmt)).scalars().all()

        miner_summaries: list[MinerHealthSummary] = []
        for m in miners:
            summary = await self.aggregate_miner_health(str(m.id))
            miner_summaries.append(summary)

        active = [s for s in miner_summaries if s.status == "running" or s.status == "active"]
        down = [s for s in miner_summaries if s.status == "stopped" or s.status == "error" or s.status == "unknown"]

        scores = [s.health_score for s in miner_summaries if s.health_score is not None]
        utils = [s.gpu_utilization_avg for s in miner_summaries if s.gpu_utilization_avg is not None]
        temps = [s.gpu_temperature_avg for s in miner_summaries if s.gpu_temperature_avg is not None]
        emissions = [s.emission for s in miner_summaries if s.emission is not None]
        incentives = [s.incentive for s in miner_summaries if s.incentive is not None]

        return SubnetPerformance(
            netuid=netuid,
            miner_count=len(miners),
            active_miners=len(active),
            down_miners=len(down),
            avg_health_score=sum(scores) / len(scores) if scores else None,
            avg_gpu_utilization=sum(utils) / len(utils) if utils else None,
            avg_gpu_temperature=sum(temps) / len(temps) if temps else None,
            total_emission=sum(emissions) if emissions else None,
            total_incentive=sum(incentives) if incentives else None,
            miners=miner_summaries,
        )

    async def get_system_overview(self) -> SystemOverview:
        all_miners_stmt = select(Miner)
        all_miners = (await self.db.execute(all_miners_stmt)).scalars().all()

        active = [m for m in all_miners if m.status in ("running", "active")]
        inactive = [m for m in all_miners if m.status in ("stopped", "paused")]
        down = [m for m in all_miners if m.status in ("error", "unknown") or m.status is None]

        subnets = {m.netuid for m in all_miners}
        scores = [m.health_score for m in all_miners if m.health_score is not None]

        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(hours=24)

        emission_24h = 0.0
        incentive_24h = 0.0
        for m in all_miners:
            health_stmt = (
                select(MinerHealth)
                .where(MinerHealth.miner_id == m.id, MinerHealth.recorded_at >= cutoff)
                .order_by(MinerHealth.recorded_at.desc())
                .limit(1)
            )
            latest = (await self.db.execute(health_stmt)).scalar_one_or_none()
            if latest:
                if latest.emission is not None:
                    emission_24h += latest.emission
                if latest.incentive is not None:
                    incentive_24h += latest.incentive

        return SystemOverview(
            total_miners=len(all_miners),
            active_miners=len(active),
            inactive_miners=len(inactive),
            down_miners=len(down),
            total_subnets=len(subnets),
            active_subnets=len(subnets),
            total_alerts=0,
            critical_alerts=0,
            warning_alerts=0,
            info_alerts=0,
            avg_system_health_score=sum(scores) / len(scores) if scores else None,
            total_emission_24h=emission_24h if emission_24h else None,
            total_incentive_24h=incentive_24h if incentive_24h else None,
        )
