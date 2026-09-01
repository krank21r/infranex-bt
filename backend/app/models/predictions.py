"""
Predictions vs actuals + accuracy tracking.
"""
from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Prediction(Base):
    __tablename__ = "predictions"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    deployment_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    netuid: Mapped[int] = mapped_column(Integer, nullable=False)
    prediction_type: Mapped[str] = mapped_column(Text, nullable=False)
    predicted_value: Mapped[float] = mapped_column(Float, nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str | None] = mapped_column(Text, server_default="INR", nullable=True)
    score_model_version: Mapped[str | None] = mapped_column(Text, nullable=True)
    extra_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, server_default="{}", nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)


class ActualResult(Base):
    __tablename__ = "actual_results"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    prediction_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    deployment_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    netuid: Mapped[int] = mapped_column(Integer, nullable=False)
    result_type: Mapped[str] = mapped_column(Text, nullable=False)
    actual_value: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str | None] = mapped_column(Text, server_default="INR", nullable=True)
    period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)


class PredictionAccuracy(Base):
    __tablename__ = "prediction_accuracy"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    deployment_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    netuid: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prediction_type: Mapped[str] = mapped_column(Text, nullable=False)
    predicted_value: Mapped[float] = mapped_column(Float, nullable=False)
    actual_value: Mapped[float] = mapped_column(Float, nullable=False)
    error_percentage: Mapped[float] = mapped_column(Float, nullable=False)
    absolute_error: Mapped[float] = mapped_column(Float, nullable=False)
    score_model_version: Mapped[str | None] = mapped_column(Text, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)
