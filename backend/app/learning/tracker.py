"""
Accuracy tracker.

Compares predicted OpportunityScore values against actual ROI outcomes
observed after 7, 14, and 30 days. Produces accuracy metrics and drift
alerts for the Learning Engine.
"""
import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AccuracyTracking as AccuracyTrackingORM,
)
from app.models import (
    Deployment,
    OpportunityScore,
    Profitability,
    ScoreComponent,
)
from app.models import (
    DriftAlert as DriftAlertORM,
)

logger = logging.getLogger(__name__)

LEARNING_MODEL_VERSION = "v1.0"


@dataclass(frozen=True)
class AccuracyRecord:
    """One predicted-vs-actual comparison."""
    opportunity_score_id: str
    deployment_id: str | None
    netuid: int
    predicted_score: float
    actual_roi_7d: float | None
    actual_roi_14d: float | None
    actual_roi_30d: float | None
    actual_roi: float | None
    error_percentage: float | None
    absolute_error: float | None
    component_errors: dict[str, float]
    score_model_version: str | None
    evaluation_days: int
    recorded_at: Any

    def to_dict(self) -> dict[str, Any]:
        return {
            "opportunity_score_id": self.opportunity_score_id,
            "deployment_id": self.deployment_id,
            "netuid": self.netuid,
            "predicted_score": self.predicted_score,
            "actual_roi_7d": self.actual_roi_7d,
            "actual_roi_14d": self.actual_roi_14d,
            "actual_roi_30d": self.actual_roi_30d,
            "actual_roi": self.actual_roi,
            "error_percentage": self.error_percentage,
            "absolute_error": self.absolute_error,
            "component_errors": self.component_errors,
            "score_model_version": self.score_model_version,
            "evaluation_days": self.evaluation_days,
            "recorded_at": str(self.recorded_at) if self.recorded_at else None,
        }


@dataclass(frozen=True)
class AccuracyMetrics:
    """Aggregated accuracy stats for a model version."""
    model_version: str
    sample_size: int
    mean_absolute_error: float | None
    mean_error_percentage: float | None
    median_error_percentage: float | None
    within_10_pct: float
    within_25_pct: float
    within_50_pct: float
    component_accuracy: dict[str, dict[str, float | None]]
    computed_at: Any

    def to_dict(self) -> dict[str, Any]:
        return {
            "model_version": self.model_version,
            "sample_size": self.sample_size,
            "mean_absolute_error": self.mean_absolute_error,
            "mean_error_percentage": self.mean_error_percentage,
            "median_error_percentage": self.median_error_percentage,
            "within_10_pct": self.within_10_pct,
            "within_25_pct": self.within_25_pct,
            "within_50_pct": self.within_50_pct,
            "component_accuracy": self.component_accuracy,
            "computed_at": str(self.computed_at) if self.computed_at else None,
        }


@dataclass(frozen=True)
class DriftAlert:
    """Signal that model accuracy has drifted beyond threshold."""
    model_version: str
    metric_name: str
    current_value: float
    baseline_value: float
    drift_ratio: float
    threshold: float
    severity: str
    is_resolved: bool
    resolved_at: Any | None
    created_at: Any

    def to_dict(self) -> dict[str, Any]:
        return {
            "model_version": self.model_version,
            "metric_name": self.metric_name,
            "current_value": self.current_value,
            "baseline_value": self.baseline_value,
            "drift_ratio": self.drift_ratio,
            "threshold": self.threshold,
            "severity": self.severity,
            "is_resolved": self.is_resolved,
            "resolved_at": str(self.resolved_at) if self.resolved_at else None,
            "created_at": str(self.created_at) if self.created_at else None,
        }


class AccuracyTracker:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def track_prediction(
        self,
        opportunity_score_id: str,
        actual_roi_after_days: int,
    ) -> AccuracyRecord | None:
        """Compare a past OpportunityScore prediction against actual ROI.

        Fetches the score row, the linked deployment (if any), and the
        profitability rows that have accumulated since the score was created.
        """
        score_row = (
            await self.db.execute(
                select(OpportunityScore).where(OpportunityScore.id == opportunity_score_id)
            )
        ).scalar_one_or_none()
        if score_row is None:
            logger.warning("OpportunityScore %s not found", opportunity_score_id)
            return None

        deployment_id = None
        dep_q = await self.db.execute(
            select(Deployment.id, Deployment.estimated_monthly_cost)
            .where(Deployment.opportunity_score_id == opportunity_score_id)
            .limit(1)
        )
        dep_row = dep_q.one_or_none()
        if dep_row:
            deployment_id = dep_row.id

        prof_rows = []
        if deployment_id:
            cutoff = func.now() - func.cast(f"{actual_roi_after_days} days", "interval")
            stmt = (
                select(Profitability)
                .where(Profitability.deployment_id == deployment_id)
                .where(Profitability.period_start >= cutoff)
                .order_by(Profitability.period_start.asc())
            )
            prof_rows = (await self.db.execute(stmt)).scalars().all()

        total_revenue = sum(float(r.total_revenue or 0.0) for r in prof_rows)
        total_cost = sum(float(r.total_expenses or 0.0) for r in prof_rows)
        actual_roi = None
        if total_cost and total_cost > 0:
            actual_roi = (total_revenue - total_cost) / total_cost

        predicted = float(score_row.score or 0.0)
        error_pct = None
        abs_error = None
        if actual_roi is not None:
            # Map ROI [-1, +inf) to comparable scale vs predicted [0, 100]
            # Use simple absolute error on the raw values for now
            abs_error = abs(predicted - actual_roi)
            if predicted != 0:
                error_pct = abs_error / abs(predicted) * 100.0

        comp_rows = (
            await self.db.execute(
                select(ScoreComponent).where(ScoreComponent.opportunity_score_id == opportunity_score_id)
            )
        ).scalars().all()
        component_errors: dict[str, float] = {}
        for c in comp_rows:
            if actual_roi is not None and c.weight and c.weight > 0:
                component_errors[c.component_name] = abs(
                    float(c.weight) - (actual_roi / max(predicted, 1e-9))
                )
            else:
                component_errors[c.component_name] = 0.0

        actual_7d = actual_roi if actual_roi_after_days == 7 else None
        actual_14d = actual_roi if actual_roi_after_days == 14 else None
        actual_30d = actual_roi if actual_roi_after_days == 30 else None

        record = AccuracyRecord(
            opportunity_score_id=opportunity_score_id,
            deployment_id=deployment_id,
            netuid=score_row.netuid,
            predicted_score=predicted,
            actual_roi_7d=actual_7d,
            actual_roi_14d=actual_14d,
            actual_roi_30d=actual_30d,
            actual_roi=actual_roi,
            error_percentage=round(error_pct, 4) if error_pct is not None else None,
            absolute_error=round(abs_error, 4) if abs_error is not None else None,
            component_errors=component_errors,
            score_model_version=score_row.score_model_version,
            evaluation_days=actual_roi_after_days,
            recorded_at=func.now(),
        )

        orm_row = AccuracyTrackingORM(
            opportunity_score_id=opportunity_score_id,
            deployment_id=deployment_id,
            netuid=score_row.netuid,
            predicted_score=predicted,
            actual_roi_7d=actual_7d,
            actual_roi_14d=actual_14d,
            actual_roi_30d=actual_30d,
            actual_roi=actual_roi,
            error_percentage=record.error_percentage,
            absolute_error=record.absolute_error,
            component_errors=component_errors,
            score_model_version=score_row.score_model_version,
            evaluation_days=actual_roi_after_days,
        )
        self.db.add(orm_row)
        await self.db.flush()

        return record

    async def compute_model_accuracy(self, model_version: str) -> AccuracyMetrics:
        """Aggregate accuracy stats for all tracked predictions of a model version."""
        rows = (
            await self.db.execute(
                select(AccuracyTrackingORM).where(
                    AccuracyTrackingORM.score_model_version == model_version
                )
            )
        ).scalars().all()

        sample_size = len(rows)
        errors = [float(r.error_percentage) for r in rows if r.error_percentage is not None]
        abs_errors = [float(r.absolute_error) for r in rows if r.absolute_error is not None]

        mean_abs = sum(abs_errors) / len(abs_errors) if abs_errors else None
        mean_err = sum(errors) / len(errors) if errors else None
        median_err = None
        if errors:
            s = sorted(errors)
            mid = len(s) // 2
            median_err = s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2.0

        within_10 = sum(1 for e in errors if e <= 10.0) / len(errors) if errors else 0.0
        within_25 = sum(1 for e in errors if e <= 25.0) / len(errors) if errors else 0.0
        within_50 = sum(1 for e in errors if e <= 50.0) / len(errors) if errors else 0.0

        comp_acc: dict[str, dict[str, float | None]] = {}
        for r in rows:
            if r.component_errors:
                for comp_name, err_val in r.component_errors.items():
                    if comp_name not in comp_acc:
                        comp_acc[comp_name] = {"errors": [], "mean_error": None, "sample_count": 0}
                    comp_acc[comp_name]["errors"].append(float(err_val))
                    comp_acc[comp_name]["sample_count"] += 1

        for comp_name, data in comp_acc.items():
            errs = data["errors"]
            data["mean_error"] = round(sum(errs) / len(errs), 4) if errs else None
            del data["errors"]

        return AccuracyMetrics(
            model_version=model_version,
            sample_size=sample_size,
            mean_absolute_error=round(mean_abs, 4) if mean_abs is not None else None,
            mean_error_percentage=round(mean_err, 4) if mean_err is not None else None,
            median_error_percentage=round(median_err, 4) if median_err is not None else None,
            within_10_pct=round(within_10, 4),
            within_25_pct=round(within_25, 4),
            within_50_pct=round(within_50, 4),
            component_accuracy=comp_acc,
            computed_at=func.now(),
        )

    async def detect_drift(
        self, model_version: str, threshold: float = 0.3
    ) -> list[DriftAlert]:
        """Detect if model accuracy has drifted beyond the given threshold.

        Compares recent accuracy metrics against the historical baseline
        for the same model version. Returns a list of DriftAlert objects.
        """
        all_rows = (
            await self.db.execute(
                select(AccuracyTrackingORM).where(
                    AccuracyTrackingORM.score_model_version == model_version
                )
            )
        ).scalars().all()

        if len(all_rows) < 10:
            logger.info(
                "Insufficient samples (%d) for drift detection on %s",
                len(all_rows),
                model_version,
            )
            return []

        mid = len(all_rows) // 2
        baseline_rows = all_rows[:mid]
        recent_rows = all_rows[mid:]

        def _avg_error(rows: list[AccuracyTrackingORM]) -> float | None:
            vals = [float(r.error_percentage) for r in rows if r.error_percentage is not None]
            if not vals:
                return None
            return sum(vals) / len(vals)

        baseline_err = _avg_error(baseline_rows)
        recent_err = _avg_error(recent_rows)

        alerts: list[DriftAlert] = []
        if baseline_err is None or recent_err is None or baseline_err == 0:
            return alerts

        drift_ratio = abs(recent_err - baseline_err) / baseline_err
        if drift_ratio > threshold:
            severity = "critical" if drift_ratio > threshold * 2 else "warning"
            alert = DriftAlert(
                model_version=model_version,
                metric_name="mean_error_percentage",
                current_value=round(recent_err, 4),
                baseline_value=round(baseline_err, 4),
                drift_ratio=round(drift_ratio, 4),
                threshold=threshold,
                severity=severity,
                is_resolved=False,
                resolved_at=None,
                created_at=func.now(),
            )

            orm_row = DriftAlertORM(
                model_version=model_version,
                metric_name="mean_error_percentage",
                current_value=alert.current_value,
                baseline_value=alert.baseline_value,
                drift_ratio=alert.drift_ratio,
                threshold=alert.threshold,
                severity=alert.severity,
            )
            self.db.add(orm_row)
            await self.db.flush()
            alerts.append(alert)

        return alerts
