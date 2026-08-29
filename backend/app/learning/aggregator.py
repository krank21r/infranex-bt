"""
Performance aggregator.

Pulls actual mining data from the existing tables (rewards, profitability,
miner_health, emissions) and produces structured PerformanceReport and
SubnetPerformance objects for the Learning Engine.
"""
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Deployment,
    Miner,
    MinerHealth,
    Profitability,
    Emission,
    PerformanceReport as PerformanceReportORM,
)

logger = logging.getLogger(__name__)

LEARNING_MODEL_VERSION = "v1.0"


@dataclass(frozen=True)
class PerformanceReport:
    """Aggregated performance metrics for a single deployment or subnet."""
    deployment_id: Optional[str]
    netuid: int
    report_type: str
    window_days: int
    period_start: Any
    period_end: Any
    total_revenue: Optional[float]
    total_cost: Optional[float]
    total_profit: Optional[float]
    roi: Optional[float]
    uptime_ratio: Optional[float]
    emission_per_block_avg: Optional[float]
    emission_per_block_median: Optional[float]
    health_score_avg: Optional[float]
    sample_size: int
    model_version: str
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "deployment_id": self.deployment_id,
            "netuid": self.netuid,
            "report_type": self.report_type,
            "window_days": self.window_days,
            "period_start": str(self.period_start) if self.period_start else None,
            "period_end": str(self.period_end) if self.period_end else None,
            "total_revenue": self.total_revenue,
            "total_cost": self.total_cost,
            "total_profit": self.total_profit,
            "roi": self.roi,
            "uptime_ratio": self.uptime_ratio,
            "emission_per_block_avg": self.emission_per_block_avg,
            "emission_per_block_median": self.emission_per_block_median,
            "health_score_avg": self.health_score_avg,
            "sample_size": self.sample_size,
            "model_version": self.model_version,
            "metadata": self.metadata,
        }


@dataclass(frozen=True)
class SubnetPerformance:
    """Aggregated performance metrics for a subnet across all deployments."""
    netuid: int
    window_days: int
    deployment_count: int
    avg_roi: Optional[float]
    median_roi: Optional[float]
    total_revenue: Optional[float]
    total_cost: Optional[float]
    total_profit: Optional[float]
    avg_uptime_ratio: Optional[float]
    avg_health_score: Optional[float]
    emission_per_block_avg: Optional[float]
    model_version: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "netuid": self.netuid,
            "window_days": self.window_days,
            "deployment_count": self.deployment_count,
            "avg_roi": self.avg_roi,
            "median_roi": self.median_roi,
            "total_revenue": self.total_revenue,
            "total_cost": self.total_cost,
            "total_profit": self.total_profit,
            "avg_uptime_ratio": self.avg_uptime_ratio,
            "avg_health_score": self.avg_health_score,
            "emission_per_block_avg": self.emission_per_block_avg,
            "model_version": self.model_version,
        }


class PerformanceAggregator:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _fetch_profitability_rows(
        self, deployment_id: str, window_days: int
    ) -> List[Profitability]:
        stmt = (
            select(Profitability)
            .where(Profitability.deployment_id == deployment_id)
            .where(
                Profitability.period_start >= func.now() - func.cast(f"{window_days} days", "interval")
            )
            .order_by(Profitability.period_start.asc())
        )
        rows = (await self.db.execute(stmt)).scalars().all()
        return list(rows)

    async def _fetch_health_rows(
        self, deployment_id: str, window_days: int
    ) -> List[MinerHealth]:
        miners_q = await self.db.execute(
            select(Miner.id).where(Miner.deployment_id == deployment_id)
        )
        miner_ids = [row.id for row in miners_q.scalars().all()]
        if not miner_ids:
            return []

        stmt = (
            select(MinerHealth)
            .where(MinerHealth.miner_id.in_(miner_ids))
            .where(
                MinerHealth.recorded_at >= func.now() - func.cast(f"{window_days} days", "interval")
            )
            .order_by(MinerHealth.recorded_at.asc())
        )
        rows = (await self.db.execute(stmt)).scalars().all()
        return list(rows)

    async def _fetch_emission_rows(
        self, deployment_id: str, window_days: int
    ) -> List[Emission]:
        dep_q = await self.db.execute(
            select(Deployment.netuid).where(Deployment.id == deployment_id)
        )
        dep = dep_q.scalar_one_or_none()
        if dep is None:
            return []

        stmt = (
            select(Emission)
            .where(Emission.netuid == dep.netuid)
            .where(
                Emission.recorded_at >= func.now() - func.cast(f"{window_days} days", "interval")
            )
            .order_by(Emission.recorded_at.asc())
        )
        rows = (await self.db.execute(stmt)).scalars().all()
        return list(rows)

    async def aggregate_miner_performance(
        self, deployment_id: str, window_days: int = 30
    ) -> Optional[PerformanceReport]:
        """Aggregate actual performance for one deployment over a trailing window."""
        dep_q = await self.db.execute(
            select(Deployment.netuid, Deployment.estimated_monthly_cost)
            .where(Deployment.id == deployment_id)
        )
        dep = dep_q.one_or_none()
        if dep is None:
            logger.warning("Deployment %s not found for performance aggregation", deployment_id)
            return None

        netuid = dep.netuid
        monthly_cost = float(dep.estimated_monthly_cost or 0.0)

        prof_rows = await self._fetch_profitability_rows(deployment_id, window_days)
        health_rows = await self._fetch_health_rows(deployment_id, window_days)
        emission_rows = await self._fetch_emission_rows(deployment_id, window_days)

        period_start = None
        period_end = None
        if prof_rows:
            period_start = min(r.period_start for r in prof_rows)
            period_end = max(r.period_end for r in prof_rows)

        total_revenue = sum(float(r.total_revenue or 0.0) for r in prof_rows)
        total_cost = sum(float(r.total_expenses or 0.0) for r in prof_rows)
        total_profit = total_revenue - total_cost if total_cost else None
        roi = (total_profit / total_cost) if total_cost and total_cost > 0 else None

        uptime_ratio = None
        if health_rows:
            up_count = sum(1 for h in health_rows if h.miner_process_running)
            uptime_ratio = up_count / len(health_rows) if health_rows else None

        emissions = [float(r.emission_amount or 0.0) for r in emission_rows if r.emission_amount is not None]
        emission_avg = sum(emissions) / len(emissions) if emissions else None
        emission_median = None
        if emissions:
            s = sorted(emissions)
            mid = len(s) // 2
            emission_median = s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2.0

        health_scores = [float(h.health_score) for h in health_rows if h.health_score is not None]
        health_avg = sum(health_scores) / len(health_scores) if health_scores else None

        sample_size = len(prof_rows)

        report = PerformanceReport(
            deployment_id=deployment_id,
            netuid=netuid,
            report_type="miner",
            window_days=window_days,
            period_start=period_start,
            period_end=period_end,
            total_revenue=round(total_revenue, 4) if total_revenue is not None else None,
            total_cost=round(total_cost, 4) if total_cost is not None else None,
            total_profit=round(total_profit, 4) if total_profit is not None else None,
            roi=round(roi, 4) if roi is not None else None,
            uptime_ratio=round(uptime_ratio, 4) if uptime_ratio is not None else None,
            emission_per_block_avg=round(emission_avg, 6) if emission_avg is not None else None,
            emission_per_block_median=round(emission_median, 6) if emission_median is not None else None,
            health_score_avg=round(health_avg, 4) if health_avg is not None else None,
            sample_size=sample_size,
            model_version=LEARNING_MODEL_VERSION,
            metadata={"monthly_cost_usd": monthly_cost},
        )

        orm_row = PerformanceReportORM(
            deployment_id=deployment_id,
            netuid=netuid,
            report_type="miner",
            window_days=window_days,
            period_start=period_start,
            period_end=period_end,
            total_revenue=report.total_revenue,
            total_cost=report.total_cost,
            total_profit=report.total_profit,
            roi=report.roi,
            uptime_ratio=report.uptime_ratio,
            emission_per_block_avg=report.emission_per_block_avg,
            emission_per_block_median=report.emission_per_block_median,
            health_score_avg=report.health_score_avg,
            sample_size=report.sample_size,
            model_version=report.model_version,
            extra_metadata=report.metadata,
        )
        self.db.add(orm_row)
        await self.db.flush()

        return report

    async def aggregate_subnet_performance(
        self, netuid: int, window_days: int = 30
    ) -> SubnetPerformance:
        """Aggregate actual performance across all deployments on a subnet."""
        dep_q = await self.db.execute(
            select(Deployment.id).where(Deployment.netuid == netuid)
        )
        deployment_ids = [row.id for row in dep_q.scalars().all()]

        deployment_count = len(deployment_ids)
        all_revenue: List[float] = []
        all_cost: List[float] = []
        all_profit: List[float] = []
        all_roi: List[float] = []
        all_uptime: List[float] = []
        all_health: List[float] = []
        all_emissions: List[float] = []

        for did in deployment_ids:
            report = await self.aggregate_miner_performance(did, window_days)
            if report is None:
                continue
            if report.total_revenue is not None:
                all_revenue.append(report.total_revenue)
            if report.total_cost is not None:
                all_cost.append(report.total_cost)
            if report.total_profit is not None:
                all_profit.append(report.total_profit)
            if report.roi is not None:
                all_roi.append(report.roi)
            if report.uptime_ratio is not None:
                all_uptime.append(report.uptime_ratio)
            if report.health_score_avg is not None:
                all_health.append(report.health_score_avg)
            if report.emission_per_block_avg is not None:
                all_emissions.append(report.emission_per_block_avg)

        def _median(values: List[float]) -> Optional[float]:
            if not values:
                return None
            s = sorted(values)
            mid = len(s) // 2
            return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2.0

        return SubnetPerformance(
            netuid=netuid,
            window_days=window_days,
            deployment_count=deployment_count,
            avg_roi=round(sum(all_roi) / len(all_roi), 4) if all_roi else None,
            median_roi=round(_median(all_roi), 4) if all_roi else None,
            total_revenue=round(sum(all_revenue), 4) if all_revenue else None,
            total_cost=round(sum(all_cost), 4) if all_cost else None,
            total_profit=round(sum(all_profit), 4) if all_profit else None,
            avg_uptime_ratio=round(sum(all_uptime) / len(all_uptime), 4) if all_uptime else None,
            avg_health_score=round(sum(all_health) / len(all_health), 4) if all_health else None,
            emission_per_block_avg=round(sum(all_emissions) / len(all_emissions), 6) if all_emissions else None,
            model_version=LEARNING_MODEL_VERSION,
        )
