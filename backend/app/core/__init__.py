"""
Core package initialization.
"""
from app.core.auth import (
    AuthError,
    create_access_token,
    create_refresh_token,
    decode_token,
    get_current_user_from_supabase,
    get_current_user_optional,
    get_token_data,
    refresh_access_token,
    require_admin,
    require_role,
    verify_supabase_token,
)
from app.core.config import settings
from app.core.database import (
    close_database,
    db_manager,
    get_async_session,
    get_supabase,
    get_supabase_admin,
    init_database,
)
from app.core.exceptions import (
    AppException,
    ConflictException,
    DatabaseException,
    ErrorResponse,
    ExternalServiceException,
    ForbiddenException,
    NotFoundException,
    RateLimitException,
    UnauthorizedException,
    ValidationException,
    raise_conflict,
    raise_forbidden,
    raise_not_found,
    raise_rate_limit,
    raise_unauthorized,
    register_exception_handlers,
)
from app.core.logging import (
    RequestLoggingMiddleware,
    configure_logging,
    get_logger,
    log_audit,
    log_performance,
    log_query,
    log_security_event,
    log_slow_query,
)

__all__ = [
    # Exceptions
    "AppException",
    "AuthError",
    "ConflictException",
    "DatabaseException",
    "ErrorResponse",
    "ExternalServiceException",
    "ForbiddenException",
    "NotFoundException",
    "RateLimitException",
    "RequestLoggingMiddleware",
    "UnauthorizedException",
    "ValidationException",
    "close_database",
    # Logging
    "configure_logging",
    # Auth
    "create_access_token",
    "create_refresh_token",
    # Database
    "db_manager",
    "decode_token",
    "get_async_session",
    "get_current_user_from_supabase",
    "get_current_user_optional",
    "get_logger",
    "get_supabase",
    "get_supabase_admin",
    "get_token_data",
    "init_database",
    "log_audit",
    "log_performance",
    "log_query",
    "log_security_event",
    "log_slow_query",
    "raise_conflict",
    "raise_forbidden",
    "raise_not_found",
    "raise_rate_limit",
    "raise_unauthorized",
    "refresh_access_token",
    "register_exception_handlers",
    "require_admin",
    "require_role",
    # Config
    "settings",
    "verify_supabase_token",
]
