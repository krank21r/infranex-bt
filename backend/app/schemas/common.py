"""
Common schemas used across the API.
"""
from typing import Generic, TypeVar, Optional, List, Any
from pydantic import BaseModel, Field, ConfigDict
from datetime import datetime


T = TypeVar("T")


class PaginationParams(BaseModel):
    """Pagination parameters for list endpoints."""
    page: int = Field(default=1, ge=1, description="Page number (1-indexed)")
    page_size: int = Field(default=20, ge=1, le=100, description="Items per page")
    
    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size
    
    @property
    def limit(self) -> int:
        return self.page_size


class PaginationMeta(BaseModel):
    """Pagination metadata for responses."""
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total_items: int = Field(ge=0)
    total_pages: int = Field(ge=0)
    has_next: bool
    has_prev: bool


class APIResponse(BaseModel, Generic[T]):
    """Standard API response wrapper."""
    success: bool = True
    data: T
    meta: Optional[PaginationMeta] = None
    message: Optional[str] = None


class ErrorResponse(BaseModel):
    """Error response model."""
    error: str
    error_code: str
    message: str
    details: Optional[dict] = None
    request_id: Optional[str] = None


class SuccessResponse(BaseModel):
    """Simple success response."""
    success: bool = True
    message: str


# --- Filter and Sort Models ---

class SortParams(BaseModel):
    """Sorting parameters."""
    sort_by: Optional[str] = Field(default=None, description="Field to sort by")
    sort_order: str = Field(default="desc", pattern="^(asc|desc)$", description="Sort order")


class FilterParams(BaseModel):
    """Base filter parameters."""
    pass


# --- Common Response Models ---

class HealthCheck(BaseModel):
    """Health check response."""
    status: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    version: str
    environment: str
    deployment_mode: str


class ReadinessCheck(BaseModel):
    """Readiness check response."""
    ready: bool
    checks: dict


class LivenessCheck(BaseModel):
    """Liveness check response."""
    alive: bool
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# --- Base Models with Config ---

class BaseSchema(BaseModel):
    """Base schema with common configuration."""
    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


class TimestampMixin(BaseModel):
    """Mixin for created_at/updated_at timestamps."""
    created_at: datetime
    updated_at: Optional[datetime] = None


class IDMixin(BaseModel):
    """Mixin for ID field."""
    id: str