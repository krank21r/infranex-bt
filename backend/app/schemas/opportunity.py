"""
Opportunity scoring schemas for subnet investment analysis.
"""
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, ConfigDict
from datetime import datetime
from decimal import Decimal

from app.schemas.common import BaseSchema, TimestampMixin, IDMixin


class ScoreComponent(BaseSchema):
    """Individual score component breakdown."""
    name: str = Field(description="Component name")
    value: Decimal = Field(description="Raw value")
    normalized: Decimal = Field(description="Normalized value (0-1)")
    weight: Decimal = Field(description="Component weight")
    weighted_score: Decimal = Field(description="Weighted score contribution")
    description: Optional[str] = Field(default=None, description="Human-readable description")


class OpportunityScore(BaseSchema, IDMixin, TimestampMixin):
    """Complete opportunity score for a subnet."""
    netuid: int
    subnet_name: str
    
    # Overall score
    total_score: Decimal = Field(description="Total opportunity score (0-100)")
    rank: Optional[int] = Field(default=None, description="Rank among all subnets")
    percentile: Optional[Decimal] = Field(default=None, description="Percentile rank")
    
    # Score components
    components: List[ScoreComponent] = Field(default_factory=list)
    
    # Key metrics used in scoring
    stake_yield: Optional[Decimal] = Field(default=None, description="Stake yield %")
    emission_yield: Optional[Decimal] = Field(default=None, description="Emission yield %")
    growth_rate: Optional[Decimal] = Field(default=None, description="Growth rate %")
    stability_score: Optional[Decimal] = Field(default=None, description="Stability score (0-100)")
    risk_score: Optional[Decimal] = Field(default=None, description="Risk score (0-100)")
    liquidity_score: Optional[Decimal] = Field(default=None, description="Liquidity score (0-100)")
    
    # ROI projections
    roi_30d: Optional[Decimal] = Field(default=None, description="30-day ROI projection %")
    roi_90d: Optional[Decimal] = Field(default=None, description="90-day ROI projection %")
    roi_1y: Optional[Decimal] = Field(default=None, description="1-year ROI projection %")
    
    # Risk factors
    risk_factors: List[str] = Field(default_factory=list, description="Identified risk factors")
    
    # Recommendation
    recommendation: str = Field(description="Investment recommendation")
    confidence: Decimal = Field(description="Confidence level (0-1)")
    
    # Metadata
    calculated_at: datetime = Field(description="When score was calculated")
    data_freshness: str = Field(description="Data freshness indicator")
    metadata: Dict[str, Any] = Field(default_factory=dict)


class OpportunityScoreHistory(BaseSchema):
    """Historical opportunity score point."""
    netuid: int
    total_score: Decimal
    rank: Optional[int] = None
    recommendation: str
    calculated_at: datetime


class OpportunityFilterParams(BaseSchema):
    """Filter parameters for opportunity queries."""
    min_score: Optional[Decimal] = None
    max_score: Optional[Decimal] = None
    min_roi_30d: Optional[Decimal] = None
    max_risk_score: Optional[Decimal] = None
    recommendation: Optional[str] = None
    category: Optional[str] = None


class OpportunitySortParams(BaseSchema):
    """Sort parameters for opportunity queries."""
    sort_by: str = Field(default="total_score", description="Field to sort by")
    sort_order: str = Field(default="desc", pattern="^(asc|desc)$")


class OpportunityListResponse(BaseSchema):
    """Paginated opportunity list response."""
    items: List[OpportunityScore]
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