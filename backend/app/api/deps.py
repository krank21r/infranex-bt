"""
API dependencies for FastAPI endpoints.
"""
from typing import Optional, AsyncGenerator, List
from fastapi import Depends, Query, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_async_session as _get_async_session, get_supabase, get_supabase_admin
from app.core.auth import (
    get_current_user_from_supabase,
    get_current_user_optional,
    get_token_data,
    require_role,
    require_admin,
)
from app.schemas.common import PaginationParams, PaginationMeta, SortParams


# --- Database Dependencies ---

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Get database session."""
    async for session in _get_async_session():
        yield session


async def get_supabase_client():
    """Get Supabase client."""
    return await get_supabase()


async def get_supabase_admin_client():
    """Get Supabase admin client."""
    return await get_supabase_admin()


# --- Authentication Dependencies ---

async def get_current_user(
    current_user = Depends(get_current_user_from_supabase),
) -> User:
    """Get current authenticated user (required)."""
    return current_user


async def get_optional_user(
    current_user = Depends(get_current_user_optional),
) -> Optional[User]:
    """Get current user if authenticated, otherwise None."""
    return current_user


async def get_token_payload(
    token_data = Depends(get_token_data),
) -> TokenData:
    """Get validated token payload."""
    return token_data


def require_permissions(*required_roles: str):
    """Dependency factory for role-based access."""
    return require_role(required_roles[0]) if required_roles else require_admin


# --- Pagination Dependencies ---

def get_pagination_params(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(
        settings.DEFAULT_PAGE_SIZE,
        ge=1,
        le=settings.MAX_PAGE_SIZE,
        description="Items per page",
    ),
) -> PaginationParams:
    """Get pagination parameters from query."""
    return PaginationParams(page=page, page_size=page_size)


def create_pagination_meta(
    params: PaginationParams,
    total_items: int,
) -> PaginationMeta:
    """Create pagination metadata."""
    total_pages = (total_items + params.page_size - 1) // params.page_size
    return PaginationMeta(
        page=params.page,
        page_size=params.page_size,
        total_items=total_items,
        total_pages=total_pages,
        has_next=params.page < total_pages,
        has_prev=params.page > 1,
    )


# --- Sorting Dependencies ---

def get_sort_params(
    sort_by: Optional[str] = Query(None, description="Field to sort by"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$", description="Sort order"),
) -> SortParams:
    """Get sorting parameters from query."""
    return SortParams(sort_by=sort_by, sort_order=sort_order)


# --- Filter Dependencies ---

class FilterDependency:
    """Base class for filter dependencies."""
    
    def __init__(self, filter_model):
        self.filter_model = filter_model
    
    def __call__(self, **filters) -> BaseModel:
        # Filter out None values
        filtered = {k: v for k, v in filters.items() if v is not None}
        return self.filter_model(**filtered)


# --- Request Context Dependencies ---

def get_request_id(request: Request) -> str:
    """Get request ID from headers or state."""
    return getattr(request.state, "request_id", request.headers.get("X-Request-ID", "unknown"))


def get_client_ip(request: Request) -> str:
    """Get client IP address."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def get_user_agent(request: Request) -> str:
    """Get user agent string."""
    return request.headers.get("User-Agent", "unknown")


# --- Rate Limiting Dependency ---

from collections import defaultdict
import time

_rate_limit_store = defaultdict(list)


async def rate_limit(
    request: Request,
    max_requests: int = settings.RATE_LIMIT_REQUESTS,
    window_seconds: int = settings.RATE_LIMIT_WINDOW_SECONDS,
) -> None:
    """Simple in-memory rate limiter."""
    client_ip = get_client_ip(request)
    now = time.time()
    
    # Clean old entries
    _rate_limit_store[client_ip] = [
        ts for ts in _rate_limit_store[client_ip]
        if now - ts < window_seconds
    ]
    
    if len(_rate_limit_store[client_ip]) >= max_requests:
        oldest = _rate_limit_store[client_ip][0]
        retry_after = int(window_seconds - (now - oldest)) + 1
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded. Try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )
    
    _rate_limit_store[client_ip].append(now)


# --- Service Dependencies ---

from app.services.subnet_service import SubnetService
from app.services.opportunity_service import OpportunityService
from app.services.gpu_service import GPUService


def get_subnet_service(
    db: AsyncSession = Depends(get_db),
) -> SubnetService:
    """Get subnet service instance."""
    return SubnetService(db)


def get_opportunity_service(
    db: AsyncSession = Depends(get_db),
) -> OpportunityService:
    """Get opportunity service instance."""
    return OpportunityService(db)


def get_gpu_service(
    db: AsyncSession = Depends(get_db),
) -> GPUService:
    """Get GPU service instance."""
    return GPUService(db)


# --- Import User for type hints ---
from app.schemas.auth import User, TokenData