"""
Subnet schemas for Bittensor subnet data.
"""
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, ConfigDict
from datetime import datetime
from decimal import Decimal

from app.schemas.common import BaseSchema, TimestampMixin, IDMixin


class SubnetMetrics(BaseSchema):
    """Current subnet metrics."""
    netuid: int
    block: int
    timestamp: datetime
    
    # Emission & Stakes
    total_stake: Decimal = Field(description="Total TAO staked in subnet")
    total_stake_usd: Optional[Decimal] = Field(default=None, description="Total stake in USD")
    tao_price_usd: Optional[Decimal] = Field(default=None, description="Current TAO price in USD")
    
    # Emission
    emission_tao_per_block: Decimal = Field(description="TAO emitted per block")
    emission_tao_per_day: Decimal = Field(description="TAO emitted per day")
    emission_usd_per_day: Optional[Decimal] = Field(default=None, description="Daily emission in USD")
    
    # Validator Info
    num_validators: int = Field(description="Number of active validators")
    num_miners: int = Field(description="Number of active miners")
    num_uids: int = Field(description="Total UIDs in subnet")
    
    # Performance
    avg_validator_performance: Optional[Decimal] = Field(default=None, description="Avg validator performance")
    avg_miner_performance: Optional[Decimal] = Field(default=None, description="Avg miner performance")
    
    # Incentives
    validator_incentive: Optional[Decimal] = Field(default=None, description="Validator incentive")
    miner_incentive: Optional[Decimal] = Field(default=None, description="Miner incentive")
    
    # Weights
    weight_version: Optional[int] = Field(default=None, description="Weight version")
    tempo: Optional[int] = Field(default=None, description="Tempo (blocks per epoch)")
    
    # Registration
    registration_cost_tao: Optional[Decimal] = Field(default=None, description="Registration cost in TAO")
    registration_cost_usd: Optional[Decimal] = Field(default=None, description="Registration cost in USD")
    
    # Additional metrics
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)


class SubnetMetricsHistory(BaseSchema):
    """Historical subnet metrics point."""
    netuid: int
    block: int
    timestamp: datetime
    
    total_stake: Decimal
    total_stake_usd: Optional[Decimal] = None
    tao_price_usd: Optional[Decimal] = None
    
    emission_tao_per_block: Decimal
    emission_tao_per_day: Decimal
    emission_usd_per_day: Optional[Decimal] = None
    
    num_validators: int
    num_miners: int
    num_uids: int
    
    avg_validator_performance: Optional[Decimal] = None
    avg_miner_performance: Optional[Decimal] = None
    
    validator_incentive: Optional[Decimal] = None
    miner_incentive: Optional[Decimal] = None
    
    registration_cost_tao: Optional[Decimal] = None
    registration_cost_usd: Optional[Decimal] = None


class Subnet(BaseSchema, IDMixin, TimestampMixin):
    """Subnet model."""
    netuid: int = Field(description="Subnet UID (unique identifier)")
    name: str = Field(description="Subnet name")
    description: Optional[str] = Field(default=None, description="Subnet description")
    github_repo: Optional[str] = Field(default=None, description="GitHub repository URL")
    website: Optional[str] = Field(default=None, description="Project website")
    discord: Optional[str] = Field(default=None, description="Discord invite link")
    
    # Status
    is_active: bool = Field(default=True, description="Whether subnet is active")
    is_verified: bool = Field(default=False, description="Whether subnet is verified")
    
    # Categories
    category: Optional[str] = Field(default=None, description="Subnet category (AI, compute, storage, etc.)")
    tags: List[str] = Field(default_factory=list, description="Subnet tags")
    
    # Current metrics (embedded)
    metrics: Optional[SubnetMetrics] = None
    
    # Computed fields
    roi_estimate_annual: Optional[Decimal] = Field(default=None, description="Estimated annual ROI %")
    risk_score: Optional[int] = Field(default=None, ge=0, le=100, description="Risk score 0-100")
    opportunity_score: Optional[Decimal] = Field(default=None, description="Overall opportunity score")


class SubnetListResponse(BaseSchema):
    """Paginated subnet list response."""
    items: List[Subnet]
    meta: 'PaginationMeta'


class SubnetFilterParams(BaseSchema):
    """Filter parameters for subnet queries."""
    category: Optional[str] = None
    is_active: Optional[bool] = None
    is_verified: Optional[bool] = None
    min_stake: Optional[Decimal] = None
    max_stake: Optional[Decimal] = None
    min_roi: Optional[Decimal] = None
    max_risk_score: Optional[int] = None
    search: Optional[str] = None


class SubnetSortParams(BaseSchema):
    """Sort parameters for subnet queries."""
    sort_by: str = Field(default="opportunity_score", description="Field to sort by")
    sort_order: str = Field(default="desc", pattern="^(asc|desc)$")


# Import here to avoid circular imports
from app.schemas.common import PaginationMeta

SubnetListResponse.model_rebuild()