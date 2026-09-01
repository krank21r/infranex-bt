"""
Feedback loop — periodic worker that closes the scoring loop.

Workflow per learning cycle:
  1. Find OpportunityScore rows old enough to evaluate (7+ days).
  2. For each, compute actual ROI from profitability tables.
  3. Track prediction accuracy.
  4. Compute aggregated model accuracy.
  5. Detect drift against historical baseline.
  6. Suggest bounded weight adjustments.
  7. Persist all results as auditable rows.
"""
import logging
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.learning.adapter import WeightAdapter
from app.learning.aggregator import PerformanceAggregator
from app.learning.tracker import AccuracyTracker
from app.models import (
    Deployment,
    OpportunityScore,
)

logger = logging.getLogger(__name__)


class FeedbackLoop:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.aggregator = PerformanceAggregator(db)
        self.tracker = AccuracyTracker(db)
        self.adapter = WeightAdapter(db)

    async def record_outcome(self, deployment_id: str, outcome: dict[str, Any]) -> None:
        """Record a deployment outcome manually or from an external source.

        `outcome` is a dict with at least:
          - actual_roi_7d: float or None
          - actual_roi_14d: float or None
          - actual_roi_30d: float or None
        """
        dep_q = await self.db.execute(
            select(Deployment.opportunity_score_id).where(Deployment.id == deployment_id)
        )
        row = dep_q.one_or_none()
        if row is None or row.opportunity_score_id is None:
            logger.warning(
                "No opportunity_score linked to deployment %s; cannot record outcome",
                deployment_id,
            )
            return

        score_id = row.opportunity_score_id
        for days, key in [(7, "actual_roi_7d"), (14, "actual_roi_14d"), (30, "actual_roi_30d")]:
            val = outcome.get(key)
            if val is not None:
                await self.tracker.track_prediction(score_id, days)

    async def _find_evaluable_scores(self, min_age_days: int = 7) -> list[OpportunityScore]:
        """Find OpportunityScore rows that are at least min_age_days old."""
        cutoff = func.now() - func.cast(f"{min_age_days} days", "interval")
        stmt = (
            select(OpportunityScore)
            .where(OpportunityScore.created_at <= cutoff)
            .where(OpportunityScore.is_current)
            .order_by(OpportunityScore.created_at.asc())
        )
        rows = (await self.db.execute(stmt)).scalars().all()
        return list(rows)

    async def run_learning_cycle(self) -> dict[str, Any]:
        """Execute one full learning cycle. Called periodically by a worker.

        Returns a summary dict with counts and any alerts produced.
        """
        summary: dict[str, Any] = {
            "evaluated_scores": 0,
            "accuracy_records": 0,
            "drift_alerts": 0,
            "weight_adjustments": 0,
        }

        scores = await self._find_evaluable_scores(min_age_days=7)
        logger.info("Learning cycle: found %d evaluable scores", len(scores))

        for score in scores:
            try:
                record = await self.tracker.track_prediction(score.id, actual_roi_after_days=7)
                if record is not None:
                    summary["accuracy_records"] += 1
            except Exception as exc:
                logger.error("Failed to track prediction for %s: %s", score.id, exc)

        summary["evaluated_scores"] = len(scores)

        for model_ver in ["v1.0"]:
            try:
                accuracy = await self.tracker.compute_model_accuracy(model_ver)
                if accuracy.sample_size == 0:
                    continue
                alerts = await self.tracker.detect_drift(model_ver, threshold=0.3)
                summary["drift_alerts"] += len(alerts)

                if accuracy.sample_size >= 10 and not alerts:
                    adj = await self.adapter.suggest_weight_adjustments(
                        model_ver, accuracy.to_dict()
                    )
                    if adj.adjustments:
                        summary["weight_adjustments"] += 1
            except Exception as exc:
                logger.error("Learning cycle step failed for %s: %s", model_ver, exc)

        await self.db.flush()
        logger.info("Learning cycle complete: %s", summary)
        return summary
