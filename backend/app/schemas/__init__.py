"""
Schemas package initialization.
"""
from app.schemas.auth import (
    AuthResponse,
    RefreshResponse,
    SupabaseSession,
    SupabaseUser,
    Token,
    TokenData,
    TokenRefreshRequest,
    User,
    UserProfile,
    UserUpdate,
)
from app.schemas.common import (
    APIResponse,
    BaseSchema,
    ErrorResponse,
    FilterParams,
    HealthCheck,
    IDMixin,
    LivenessCheck,
    PaginationMeta,
    PaginationParams,
    ReadinessCheck,
    SortParams,
    SuccessResponse,
    TimestampMixin,
)
from app.schemas.deployment import (
    ApprovalGateInput,
    DeploymentCreate,
    DeploymentResponse,
    ServerResponse,
    TerminateInput,
)
from app.schemas.gpu import (
    GPUFilterParams,
    GPUModel,
    GPUOffer,
    GPUOfferFilterParams,
    GPUOfferListResponse,
    GPUOfferSortParams,
    GPUProvider,
)
from app.schemas.opportunity import (
    DEFAULT_SCORING_WEIGHTS,
    OpportunityFilterParams,
    OpportunityListResponse,
    OpportunityScore,
    OpportunityScoreHistory,
    OpportunitySortParams,
    ScoreComponent,
    ScoringWeights,
)
from app.schemas.subnet import (
    Subnet,
    SubnetFilterParams,
    SubnetListResponse,
    SubnetMetrics,
    SubnetMetricsHistory,
    SubnetSortParams,
)

__all__ = [
    "DEFAULT_SCORING_WEIGHTS",
    "APIResponse",
    "ApprovalGateInput",
    "AuthResponse",
    "BaseSchema",
    # Deployment
    "DeploymentCreate",
    "DeploymentResponse",
    "ErrorResponse",
    "FilterParams",
    "GPUFilterParams",
    # GPU
    "GPUModel",
    "GPUOffer",
    "GPUOfferFilterParams",
    "GPUOfferListResponse",
    "GPUOfferSortParams",
    "GPUProvider",
    "HealthCheck",
    "IDMixin",
    "LivenessCheck",
    "OpportunityFilterParams",
    "OpportunityListResponse",
    # Opportunity
    "OpportunityScore",
    "OpportunityScoreHistory",
    "OpportunitySortParams",
    "PaginationMeta",
    # Common
    "PaginationParams",
    "ReadinessCheck",
    "RefreshResponse",
    "ScoreComponent",
    "ScoringWeights",
    "ServerResponse",
    "SortParams",
    # Subnet
    "Subnet",
    "SubnetFilterParams",
    "SubnetListResponse",
    "SubnetMetrics",
    "SubnetMetricsHistory",
    "SubnetSortParams",
    "SuccessResponse",
    "SupabaseSession",
    "SupabaseUser",
    "TerminateInput",
    "TimestampMixin",
    # Auth
    "Token",
    "TokenData",
    "TokenRefreshRequest",
    "User",
    "UserProfile",
    "UserUpdate",
]
