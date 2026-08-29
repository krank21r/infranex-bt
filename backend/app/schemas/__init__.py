"""
Schemas package initialization.
"""
from app.schemas.common import (
    PaginationParams,
    PaginationMeta,
    APIResponse,
    ErrorResponse,
    SuccessResponse,
    SortParams,
    FilterParams,
    HealthCheck,
    ReadinessCheck,
    LivenessCheck,
    BaseSchema,
    TimestampMixin,
    IDMixin,
)

from app.schemas.subnet import (
    Subnet,
    SubnetMetrics,
    SubnetMetricsHistory,
    SubnetListResponse,
    SubnetFilterParams,
    SubnetSortParams,
)

from app.schemas.opportunity import (
    OpportunityScore,
    ScoreComponent,
    OpportunityScoreHistory,
    OpportunityListResponse,
    OpportunityFilterParams,
    OpportunitySortParams,
    ScoringWeights,
    DEFAULT_SCORING_WEIGHTS,
)

from app.schemas.gpu import (
    GPUModel,
    GPUProvider,
    GPUOffer,
    GPUOfferListResponse,
    GPUFilterParams,
    GPUOfferFilterParams,
    GPUOfferSortParams,
)

from app.schemas.auth import (
    Token,
    TokenData,
    TokenRefreshRequest,
    User,
    UserProfile,
    UserUpdate,
    AuthResponse,
    RefreshResponse,
    SupabaseUser,
    SupabaseSession,
)
from app.schemas.deployment import (
    DeploymentCreate,
    DeploymentResponse,
    ServerResponse,
    ApprovalGateInput,
    TerminateInput,
)

__all__ = [
    # Common
    "PaginationParams",
    "PaginationMeta",
    "APIResponse",
    "ErrorResponse",
    "SuccessResponse",
    "SortParams",
    "FilterParams",
    "HealthCheck",
    "ReadinessCheck",
    "LivenessCheck",
    "BaseSchema",
    "TimestampMixin",
    "IDMixin",
    # Subnet
    "Subnet",
    "SubnetMetrics",
    "SubnetMetricsHistory",
    "SubnetListResponse",
    "SubnetFilterParams",
    "SubnetSortParams",
    # Opportunity
    "OpportunityScore",
    "ScoreComponent",
    "OpportunityScoreHistory",
    "OpportunityListResponse",
    "OpportunityFilterParams",
    "OpportunitySortParams",
    "ScoringWeights",
    "DEFAULT_SCORING_WEIGHTS",
    # GPU
    "GPUModel",
    "GPUProvider",
    "GPUOffer",
    "GPUOfferListResponse",
    "GPUFilterParams",
    "GPUOfferFilterParams",
    "GPUOfferSortParams",
    # Auth
    "Token",
    "TokenData",
    "TokenRefreshRequest",
    "User",
    "UserProfile",
    "UserUpdate",
    "AuthResponse",
    "RefreshResponse",
    "SupabaseUser",
    "SupabaseSession",
    # Deployment
    "DeploymentCreate",
    "DeploymentResponse",
    "ServerResponse",
    "ApprovalGateInput",
    "TerminateInput",
]