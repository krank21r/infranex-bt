"""
Opportunity scores + component breakdowns.
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class OpportunityScore(Base):
    __tablename__ = "opportunity_scores"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    risk_level: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    recommended_gpu_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    recommended_gpu_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    estimated_monthly_revenue: Mapped[float | None] = mapped_column(Float, nullable=True)
    estimated_monthly_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    estimated_monthly_profit: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str | None] = mapped_column(Text, server_default="INR", nullable=True)
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    utility_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    technical_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    economics_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    pillar_version: Mapped[str | None] = mapped_column(Text, server_default="v2.0", nullable=True)
    decision: Mapped[str | None] = mapped_column(Text, nullable=True)
    score_model_version: Mapped[str] = mapped_column(Text, server_default="v1.0", nullable=False)
    is_current: Mapped[bool | None] = mapped_column(Boolean, server_default="true", nullable=True)
    extra_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, server_default="{}", nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)


class ScoreComponent(Base):
    __tablename__ = "score_components"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    opportunity_score_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, index=True)
    component_name: Mapped[str] = mapped_column(Text, nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    weight: Mapped[float] = mapped_column(Float, server_default="1.0", nullable=False)
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_values: Mapped[dict | None] = mapped_column(JSONB, server_default="{}", nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)


class UtilityAssessment(Base):
    __tablename__ = "utility_assessments"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="gen_random_uuid()")
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    problem_clarity: Mapped[float | None] = mapped_column(Float, nullable=True)
    uniqueness: Mapped[float | None] = mapped_column(Float, nullable=True)
    description_quality: Mapped[float | None] = mapped_column(Float, nullable=True)
    development_activity: Mapped[float | None] = mapped_column(Float, nullable=True)
    tokenomics_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    governance_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    overall_utility: Mapped[float | None] = mapped_column(Float, nullable=True)
    assessed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)
