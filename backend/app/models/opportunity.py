"""
Opportunity scores + component breakdowns.
"""
from sqlalchemy import Integer, Float, Text, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from typing import Optional
from datetime import datetime

from .base import Base


class OpportunityScore(Base):
    __tablename__ = "opportunity_scores"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    risk_level: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    recommended_gpu_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    recommended_gpu_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    estimated_monthly_revenue: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    estimated_monthly_cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    estimated_monthly_profit: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    currency: Mapped[Optional[str]] = mapped_column(Text, server_default="INR", nullable=True)
    explanation: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    utility_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    technical_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    economics_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pillar_version: Mapped[Optional[str]] = mapped_column(Text, server_default="v2.0", nullable=True)
    decision: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    score_model_version: Mapped[str] = mapped_column(Text, server_default="v1.0", nullable=False)
    pillar_version: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    utility_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    technical_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    economics_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    decision: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_current: Mapped[Optional[bool]] = mapped_column(Boolean, server_default="true", nullable=True)
    extra_metadata: Mapped[Optional[dict]] = mapped_column("metadata", JSONB, server_default="{}", nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)


class ScoreComponent(Base):
    __tablename__ = "score_components"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    opportunity_score_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, index=True)
    component_name: Mapped[str] = mapped_column(Text, nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    weight: Mapped[float] = mapped_column(Float, server_default="1.0", nullable=False)
    explanation: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    raw_values: Mapped[Optional[dict]] = mapped_column(JSONB, server_default="{}", nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)


class UtilityAssessment(Base):
    __tablename__ = "utility_assessments"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="gen_random_uuid()")
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    problem_clarity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    uniqueness: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    description_quality: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    development_activity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    tokenomics_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    governance_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    overall_utility: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    assessed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)
