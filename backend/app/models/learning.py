"""
Learning Engine ORM models.

Performance aggregation, accuracy tracking, weight adjustments,
and drift alerts for the closed-loop scoring feedback system.
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class PerformanceReport(Base):
    __tablename__ = "performance_reports"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    deployment_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    report_type: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    window_days: Mapped[int] = mapped_column(Integer, nullable=False)
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    total_revenue: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_profit: Mapped[float | None] = mapped_column(Float, nullable=True)
    roi: Mapped[float | None] = mapped_column(Float, nullable=True)
    uptime_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    emission_per_block_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
    emission_per_block_median: Mapped[float | None] = mapped_column(Float, nullable=True)
    health_score_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
    sample_size: Mapped[int] = mapped_column(Integer, server_default="0", nullable=False)
    model_version: Mapped[str | None] = mapped_column(Text, nullable=True)
    extra_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, server_default="{}", nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)


class AccuracyTracking(Base):
    __tablename__ = "accuracy_tracking"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    opportunity_score_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    deployment_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    predicted_score: Mapped[float] = mapped_column(Float, nullable=False)
    actual_roi_7d: Mapped[float | None] = mapped_column(Float, nullable=True)
    actual_roi_14d: Mapped[float | None] = mapped_column(Float, nullable=True)
    actual_roi_30d: Mapped[float | None] = mapped_column(Float, nullable=True)
    actual_roi: Mapped[float | None] = mapped_column(Float, nullable=True)
    error_percentage: Mapped[float | None] = mapped_column(Float, nullable=True)
    absolute_error: Mapped[float | None] = mapped_column(Float, nullable=True)
    component_errors: Mapped[dict | None] = mapped_column(JSONB, server_default="{}", nullable=True)
    score_model_version: Mapped[str | None] = mapped_column(Text, nullable=True)
    evaluation_days: Mapped[int] = mapped_column(Integer, server_default="0", nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)


class WeightAdjustment(Base):
    __tablename__ = "weight_adjustments"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    model_version: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    previous_weights: Mapped[dict] = mapped_column(JSONB, nullable=False)
    new_weights: Mapped[dict] = mapped_column(JSONB, nullable=False)
    adjustments: Mapped[dict] = mapped_column(JSONB, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    accuracy_report_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    applied: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)


class DriftAlert(Base):
    __tablename__ = "drift_alerts"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    model_version: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    metric_name: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    current_value: Mapped[float] = mapped_column(Float, nullable=False)
    baseline_value: Mapped[float] = mapped_column(Float, nullable=False)
    drift_ratio: Mapped[float] = mapped_column(Float, nullable=False)
    threshold: Mapped[float] = mapped_column(Float, nullable=False)
    severity: Mapped[str] = mapped_column(Text, server_default="warning", nullable=False)
    is_resolved: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)
