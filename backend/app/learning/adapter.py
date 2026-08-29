"""
Weight adapter.

Analyzes accuracy reports and proposes small, bounded weight adjustments
to the scoring engine. Ensures weights always sum to 1.0 and no single
adjustment exceeds 20% per iteration.
"""
import logging
from dataclasses import dataclass
from typing import Any, Dict, List

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    WeightAdjustment as WeightAdjustmentORM,
)
from app.intelligence import DEFAULT_WEIGHTS

logger = logging.getLogger(__name__)

MAX_ADJUSTMENT_PCT = 0.20


@dataclass(frozen=True)
class ComponentAdjustment:
    """Proposed delta for one scoring component."""
    component_name: str
    old_weight: float
    new_weight: float
    delta: float
    reason: str


@dataclass(frozen=True)
class WeightAdjustment:
    """Full proposed weight change set for one model version."""
    model_version: str
    previous_weights: Dict[str, float]
    new_weights: Dict[str, float]
    adjustments: List[ComponentAdjustment]
    reason: str
    applied: bool
    created_at: Any

    def to_dict(self) -> Dict[str, Any]:
        return {
            "model_version": self.model_version,
            "previous_weights": self.previous_weights,
            "new_weights": self.new_weights,
            "adjustments": [
                {
                    "component_name": a.component_name,
                    "old_weight": a.old_weight,
                    "new_weight": a.new_weight,
                    "delta": a.delta,
                    "reason": a.reason,
                }
                for a in self.adjustments
            ],
            "reason": self.reason,
            "applied": self.applied,
            "created_at": str(self.created_at) if self.created_at else None,
        }


class WeightAdapter:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def suggest_weight_adjustments(
        self,
        model_version: str,
        accuracy_report: Dict[str, Any],
    ) -> WeightAdjustment:
        """Propose bounded weight adjustments based on component accuracy.

        Rules:
          - Weights must sum to 1.0 after adjustment.
          - No single component changes by more than 20% (absolute).
          - Only components with sufficient samples are adjusted.
          - If no component data is available, return a no-op adjustment.
        """
        current_weights = dict(DEFAULT_WEIGHTS)
        existing_q = await self.db.execute(
            select(WeightAdjustmentORM)
            .where(WeightAdjustmentORM.model_version == model_version)
            .order_by(WeightAdjustmentORM.created_at.desc())
            .limit(1)
        )
        last_adj = existing_q.scalar_one_or_none()
        if last_adj is not None:
            current_weights = dict(last_adj.new_weights)

        component_accuracy = accuracy_report.get("component_accuracy", {})
        if not component_accuracy:
            logger.info(
                "No component accuracy data for %s; returning no-op adjustment", model_version
            )
            return WeightAdjustment(
                model_version=model_version,
                previous_weights=dict(current_weights),
                new_weights=dict(current_weights),
                adjustments=[],
                reason="No component accuracy data available",
                applied=False,
                created_at=None,
            )

        comp_errors = {
            name: data.get("mean_error", None)
            for name, data in component_accuracy.items()
            if data.get("sample_count", 0) >= 3 and data.get("mean_error") is not None
        }
        if not comp_errors:
            return WeightAdjustment(
                model_version=model_version,
                previous_weights=dict(current_weights),
                new_weights=dict(current_weights),
                adjustments=[],
                reason="Insufficient component samples (< 3 per component)",
                applied=False,
                created_at=None,
            )

        max_err = max(comp_errors.values())
        min_err = min(comp_errors.values())
        if max_err == min_err:
            return WeightAdjustment(
                model_version=model_version,
                previous_weights=dict(current_weights),
                new_weights=dict(current_weights),
                adjustments=[],
                reason="All components have equal error; no adjustment warranted",
                applied=False,
                created_at=None,
            )

        adjustments: List[ComponentAdjustment] = []
        proposed_weights = dict(current_weights)

        for comp_name, err in comp_errors.items():
            old_w = current_weights.get(comp_name, 0.0)
            if max_err == 0:
                score = 0.0
            else:
                score = 1.0 - ((err - min_err) / (max_err - min_err))
            delta = (score - 0.5) * 2.0 * MAX_ADJUSTMENT_PCT
            delta = max(-MAX_ADJUSTMENT_PCT, min(MAX_ADJUSTMENT_PCT, delta))
            new_w = old_w + delta
            new_w = max(0.01, new_w)
            adjustments.append(
                ComponentAdjustment(
                    component_name=comp_name,
                    old_weight=round(old_w, 6),
                    new_weight=round(new_w, 6),
                    delta=round(delta, 6),
                    reason=(
                        f"error={err:.4f} (normalized score={score:.2f}); "
                        f"{'increased' if delta > 0 else 'decreased'} weight by {abs(delta):.4f}"
                    ),
                )
            )
            proposed_weights[comp_name] = new_w

        total = sum(proposed_weights.values())
        if total > 0:
            for comp_name in proposed_weights:
                proposed_weights[comp_name] = round(proposed_weights[comp_name] / total, 6)

        final_total = sum(proposed_weights.values())
        if abs(final_total - 1.0) > 1e-6:
            remainder = 1.0 - final_total
            largest = max(proposed_weights, key=proposed_weights.get)
            proposed_weights[largest] = round(proposed_weights[largest] + remainder, 6)

        reason_parts = [
            f"Adjusted {len(adjustments)} components based on accuracy report",
            f"Max change: {MAX_ADJUSTMENT_PCT*100:.0f}%",
            f"Baseline error range: [{min_err:.4f}, {max_err:.4f}]",
        ]
        result = WeightAdjustment(
            model_version=model_version,
            previous_weights={k: round(v, 6) for k, v in current_weights.items()},
            new_weights={k: round(v, 6) for k, v in proposed_weights.items()},
            adjustments=adjustments,
            reason="; ".join(reason_parts),
            applied=False,
            created_at=None,
        )

        orm_row = WeightAdjustmentORM(
            model_version=model_version,
            previous_weights=result.previous_weights,
            new_weights=result.new_weights,
            adjustments={
                a.component_name: {
                    "old_weight": a.old_weight,
                    "new_weight": a.new_weight,
                    "delta": a.delta,
                    "reason": a.reason,
                }
                for a in adjustments
            },
            reason=result.reason,
        )
        self.db.add(orm_row)
        await self.db.flush()

        return result

    async def apply_weight_adjustment(
        self,
        adjustment_id: str,
    ) -> bool:
        """Mark a weight adjustment as applied (after A/B validation)."""
        row = (
            await self.db.execute(
                select(WeightAdjustmentORM).where(WeightAdjustmentORM.id == adjustment_id)
            )
        ).scalar_one_or_none()
        if row is None:
            logger.warning("WeightAdjustment %s not found", adjustment_id)
            return False

        if row.applied:
            logger.info("WeightAdjustment %s already applied", adjustment_id)
            return True

        row.applied = True
        row.applied_at = func.now()
        await self.db.flush()
        return True
