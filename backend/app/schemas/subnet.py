"""
Subnet schemas for Bittensor subnet data.
"""
from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import Field

from app.schemas.common import BaseSchema, IDMixin, TimestampMixin


class SubnetMetrics(BaseSchema):
    """Current subnet metrics."""
    netuid: int
    block: int
    timestamp: datetime

    # Emission & Stakes
    total_stake: Decimal = Field(description="Total TAO staked in subnet")
    total_stake_usd: Decimal | None = Field(default=None, description="Total stake in USD")
    tao_price_usd: Decimal | None = Field(default=None, description="Current TAO price in USD")

    # Emission
    emission_tao_per_block: Decimal = Field(description="TAO emitted per block")
    emission_tao_per_day: Decimal = Field(description="TAO emitted per day")
    emission_usd_per_day: Decimal | None = Field(default=None, description="Daily emission in USD")

    # Validator Info
    num_validators: int = Field(description="Number of active validators")
    num_miners: int = Field(description="Number of active miners")
    num_uids: int = Field(description="Total UIDs in subnet")

    # Performance
    avg_validator_performance: Decimal | None = Field(default=None, description="Avg validator performance")
    avg_miner_performance: Decimal | None = Field(default=None, description="Avg miner performance")

    # Incentives
    validator_incentive: Decimal | None = Field(default=None, description="Validator incentive")
    miner_incentive: Decimal | None = Field(default=None, description="Miner incentive")

    # Weights
    weight_version: int | None = Field(default=None, description="Weight version")
    tempo: int | None = Field(default=None, description="Tempo (blocks per epoch)")

    # Registration
    registration_cost_tao: Decimal | None = Field(default=None, description="Registration cost in TAO")
    registration_cost_usd: Decimal | None = Field(default=None, description="Registration cost in USD")

    # Additional metrics
    metadata: dict[str, Any] | None = Field(default_factory=dict)


class SubnetMetricsHistory(BaseSchema):
    """Historical subnet metrics point."""
    netuid: int
    block: int
    timestamp: datetime

    total_stake: Decimal
    total_stake_usd: Decimal | None = None
    tao_price_usd: Decimal | None = None

    emission_tao_per_block: Decimal
    emission_tao_per_day: Decimal
    emission_usd_per_day: Decimal | None = None

    num_validators: int
    num_miners: int
    num_uids: int

    avg_validator_performance: Decimal | None = None
    avg_miner_performance: Decimal | None = None

    validator_incentive: Decimal | None = None
    miner_incentive: Decimal | None = None

    registration_cost_tao: Decimal | None = None
    registration_cost_usd: Decimal | None = None


class Subnet(BaseSchema, IDMixin, TimestampMixin):
    """Subnet model."""
    netuid: int = Field(description="Subnet UID (unique identifier)")
    name: str = Field(description="Subnet name")
    description: str | None = Field(default=None, description="Subnet description")
    github_repo: str | None = Field(default=None, description="GitHub repository URL")
    website: str | None = Field(default=None, description="Project website")
    discord: str | None = Field(default=None, description="Discord invite link")

    # Status
    is_active: bool = Field(default=True, description="Whether subnet is active")
    is_verified: bool = Field(default=False, description="Whether subnet is verified")

    # Categories
    category: str | None = Field(default=None, description="Subnet category (AI, compute, storage, etc.)")
    tags: list[str] = Field(default_factory=list, description="Subnet tags")

    # Current metrics (embedded)
    metrics: SubnetMetrics | None = None

    # Computed fields
    roi_estimate_annual: Decimal | None = Field(default=None, description="Estimated annual ROI %")
    risk_score: int | None = Field(default=None, ge=0, le=100, description="Risk score 0-100")
    opportunity_score: Decimal | None = Field(default=None, description="Overall opportunity score")


class SubnetListResponse(BaseSchema):
    """Paginated subnet list response."""
    items: list[Subnet]
    meta: 'PaginationMeta'


class SubnetFilterParams(BaseSchema):
    """Filter parameters for subnet queries."""
    category: str | None = None
    is_active: bool | None = None
    is_verified: bool | None = None
    min_stake: Decimal | None = None
    max_stake: Decimal | None = None
    min_roi: Decimal | None = None
    max_risk_score: int | None = None
    search: str | None = None


class SubnetSortParams(BaseSchema):
    """Sort parameters for subnet queries."""
    sort_by: str = Field(default="opportunity_score", description="Field to sort by")
    sort_order: str = Field(default="desc", pattern="^(asc|desc)$")


# Import here to avoid circular imports
from app.schemas.common import PaginationMeta

SubnetListResponse.model_rebuild()
