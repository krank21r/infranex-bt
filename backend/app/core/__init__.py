"""
Core package initialization.
"""
from app.core.config import settings
from app.core.database import (
    db_manager,
    get_supabase,
    get_supabase_admin,
    get_async_session,
    init_database,
    close_database,
)
from app.core.auth import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_supabase_token,
    get_current_user_from_supabase,
    get_current_user_optional,
    get_token_data,
    require_role,
    require_admin,
    refresh_access_token,
    AuthError,
)
from app.core.exceptions import (
    AppException,
    ValidationException,
    NotFoundException,
    ConflictException,
    UnauthorizedException,
    ForbiddenException,
    RateLimitException,
    ExternalServiceException,
    DatabaseException,
    ErrorResponse,
    register_exception_handlers,
    raise_not_found,
    raise_conflict,
    raise_unauthorized,
    raise_forbidden,
    raise_rate_limit,
)
from app.core.logging import (
    configure_logging,
    get_logger,
    RequestLoggingMiddleware,
    log_query,
    log_slow_query,
    log_audit,
    log_performance,
    log_security_event,
)

__all__ = [
    # Config
    "settings",
    # Database
    "db_manager",
    "get_supabase",
    "get_supabase_admin",
    "get_async_session",
    "init_database",
    "close_database",
    # Auth
    "create_access_token",
    "create_refresh_token",
    "decode_token",
    "verify_supabase_token",
    "get_current_user_from_supabase",
    "get_current_user_optional",
    "get_token_data",
    "require_role",
    "require_admin",
    "refresh_access_token",
    "AuthError",
    # Exceptions
    "AppException",
    "ValidationException",
    "NotFoundException",
    "ConflictException",
    "UnauthorizedException",
    "ForbiddenException",
    "RateLimitException",
    "ExternalServiceException",
    "DatabaseException",
    "ErrorResponse",
    "register_exception_handlers",
    "raise_not_found",
    "raise_conflict",
    "raise_unauthorized",
    "raise_forbidden",
    "raise_rate_limit",
    # Logging
    "configure_logging",
    "get_logger",
    "RequestLoggingMiddleware",
    "log_query",
    "log_slow_query",
    "log_audit",
    "log_performance",
    "log_security_event",
]