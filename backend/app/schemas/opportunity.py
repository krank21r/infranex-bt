"""
Opportunity scoring schemas for subnet investment analysis.
"""
from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import Field

from app.schemas.common import BaseSchema, IDMixin, TimestampMixin


class ScoreComponent(BaseSchema):
    """Individual score component breakdown."""
    name: str = Field(description="Component name")
    value: Decimal = Field(description="Raw value")
    normalized: Decimal = Field(description="Normalized value (0-1)")
    weight: Decimal = Field(description="Component weight")
    weighted_score: Decimal = Field(description="Weighted score contribution")
    description: str | None = Field(default=None, description="Human-readable description")


class OpportunityScore(BaseSchema, IDMixin, TimestampMixin):
    """Complete opportunity score for a subnet."""
    netuid: int
    subnet_name: str

    # Overall score
    total_score: Decimal = Field(description="Total opportunity score (0-100)")
    rank: int | None = Field(default=None, description="Rank among all subnets")
    percentile: Decimal | None = Field(default=None, description="Percentile rank")

    # Score components
    components: list[ScoreComponent] = Field(default_factory=list)

    # Key metrics used in scoring
    stake_yield: Decimal | None = Field(default=None, description="Stake yield %")
    emission_yield: Decimal | None = Field(default=None, description="Emission yield %")
    growth_rate: Decimal | None = Field(default=None, description="Growth rate %")
    stability_score: Decimal | None = Field(default=None, description="Stability score (0-100)")
    risk_score: Decimal | None = Field(default=None, description="Risk score (0-100)")
    liquidity_score: Decimal | None = Field(default=None, description="Liquidity score (0-100)")

    # ROI projections
    roi_30d: Decimal | None = Field(default=None, description="30-day ROI projection %")
    roi_90d: Decimal | None = Field(default=None, description="90-day ROI projection %")
    roi_1y: Decimal | None = Field(default=None, description="1-year ROI projection %")

    # Risk factors
    risk_factors: list[str] = Field(default_factory=list, description="Identified risk factors")

    # Recommendation
    recommendation: str = Field(description="Investment recommendation")
    confidence: Decimal = Field(description="Confidence level (0-1)")

    # Metadata
    calculated_at: datetime = Field(description="When score was calculated")
    data_freshness: str = Field(description="Data freshness indicator")
    metadata: dict[str, Any] = Field(default_factory=dict)


class OpportunityScoreHistory(BaseSchema):
    """Historical opportunity score point."""
    netuid: int
    total_score: Decimal
    rank: int | None = None
    recommendation: str
    calculated_at: datetime


class OpportunityFilterParams(BaseSchema):
    """Filter parameters for opportunity queries."""
    min_score: Decimal | None = None
    max_score: Decimal | None = None
    min_roi_30d: Decimal | None = None
    max_risk_score: Decimal | None = None
    recommendation: str | None = None
    category: str | None = None


class OpportunitySortParams(BaseSchema):
    """Sort parameters for opportunity queries."""
    sort_by: str = Field(default="total_score", description="Field to sort by")
    sort_order: str = Field(default="desc", pattern="^(asc|desc)$")


class OpportunityListResponse(BaseSchema):
    """Paginated opportunity list response."""
    items: list[OpportunityScore]
    meta: 'PaginationMeta'


# Rebuild with forward reference
from app.schemas.common import PaginationMeta

OpportunityListResponse.model_rebuild()


# --- Scoring Weights Config ---

class ScoringWeights(BaseSchema):
    """Configuration for scoring weights."""
    stake_yield_weight: Decimal = Field(default=Decimal("0.25"))
    emission_yield_weight: Decimal = Field(default=Decimal("0.20"))
    growth_rate_weight: Decimal = Field(default=Decimal("0.20"))
    stability_weight: Decimal = Field(default=Decimal("0.15"))
    liquidity_weight: Decimal = Field(default=Decimal("0.10"))
    risk_weight: Decimal = Field(default=Decimal("0.10"))

    def total_weight(self) -> Decimal:
        return (
            self.stake_yield_weight + self.emission_yield_weight +
            self.growth_rate_weight + self.stability_weight +
            self.liquidity_weight + self.risk_weight
        )


DEFAULT_SCORING_WEIGHTS = ScoringWeights()
