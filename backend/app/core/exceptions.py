"""
Custom exceptions and error handlers for the application.
"""
from typing import Any

import structlog
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = structlog.get_logger(__name__)


# --- Base Exceptions ---

class AppException(Exception):
    """Base application exception."""

    def __init__(
        self,
        message: str,
        status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR,
        error_code: str = "INTERNAL_ERROR",
        details: dict[str, Any] | None = None,
    ):
        self.message = message
        self.status_code = status_code
        self.error_code = error_code
        self.details = details or {}
        super().__init__(message)


class ValidationException(AppException):
    """Validation error exception."""

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(
            message=message,
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            error_code="VALIDATION_ERROR",
            details=details,
        )


class NotFoundException(AppException):
    """Resource not found exception."""

    def __init__(self, resource: str, identifier: Any):
        super().__init__(
            message=f"{resource} not found",
            status_code=status.HTTP_404_NOT_FOUND,
            error_code="NOT_FOUND",
            details={"resource": resource, "identifier": str(identifier)},
        )


class ConflictException(AppException):
    """Resource conflict exception."""

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(
            message=message,
            status_code=status.HTTP_409_CONFLICT,
            error_code="CONFLICT",
            details=details,
        )


class UnauthorizedException(AppException):
    """Unauthorized access exception."""

    def __init__(self, message: str = "Unauthorized", details: dict[str, Any] | None = None):
        super().__init__(
            message=message,
            status_code=status.HTTP_401_UNAUTHORIZED,
            error_code="UNAUTHORIZED",
            details=details,
        )


class ForbiddenException(AppException):
    """Forbidden access exception."""

    def __init__(self, message: str = "Forbidden", details: dict[str, Any] | None = None):
        super().__init__(
            message=message,
            status_code=status.HTTP_403_FORBIDDEN,
            error_code="FORBIDDEN",
            details=details,
        )


class RateLimitException(AppException):
    """Rate limit exceeded exception."""

    def __init__(self, message: str = "Rate limit exceeded", retry_after: int = 60):
        super().__init__(
            message=message,
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            error_code="RATE_LIMIT_EXCEEDED",
            details={"retry_after": retry_after},
        )


class ExternalServiceException(AppException):
    """External service error exception."""

    def __init__(self, service: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(
            message=f"{service} error: {message}",
            status_code=status.HTTP_502_BAD_GATEWAY,
            error_code="EXTERNAL_SERVICE_ERROR",
            details={"service": service, **(details or {})},
        )


class DatabaseException(AppException):
    """Database operation error exception."""

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(
            message=message,
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            error_code="DATABASE_ERROR",
            details=details,
        )


# --- Error Response Models ---


class ErrorDetail(BaseModel):
    """Error detail model."""
    field: str | None = None
    message: str
    code: str


class ErrorResponse(BaseModel):
    """Standard error response model."""
    error: str
    error_code: str
    message: str
    details: dict[str, Any] | None = None
    request_id: str | None = None


# --- Exception Handlers ---

def register_exception_handlers(app: FastAPI) -> None:
    """Register all exception handlers with the FastAPI app."""

    @app.exception_handler(AppException)
    async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
        logger.error(
            "Application error",
            error_code=exc.error_code,
            message=exc.message,
            details=exc.details,
            path=request.url.path,
        )
        return JSONResponse(
            status_code=exc.status_code,
            content=ErrorResponse(
                error=exc.__class__.__name__,
                error_code=exc.error_code,
                message=exc.message,
                details=exc.details,
                request_id=request.headers.get("X-Request-ID"),
            ).model_dump(),
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        logger.warning(
            "HTTP exception",
            status_code=exc.status_code,
            detail=exc.detail,
            path=request.url.path,
        )
        return JSONResponse(
            status_code=exc.status_code,
            content=ErrorResponse(
                error="HTTPException",
                error_code="HTTP_ERROR",
                message=str(exc.detail),
                request_id=request.headers.get("X-Request-ID"),
            ).model_dump(),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        logger.warning(
            "Validation error",
            errors=exc.errors(),
            path=request.url.path,
        )
        details = {
            "errors": [
                ErrorDetail(
                    field=".".join(str(loc) for loc in error["loc"]),
                    message=error["msg"],
                    code=error["type"],
                ).model_dump()
                for error in exc.errors()
            ]
        }
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=ErrorResponse(
                error="ValidationError",
                error_code="VALIDATION_ERROR",
                message="Request validation failed",
                details=details,
                request_id=request.headers.get("X-Request-ID"),
            ).model_dump(),
        )

    @app.exception_handler(ValidationError)
    async def pydantic_validation_exception_handler(request: Request, exc: ValidationError) -> JSONResponse:
        logger.warning(
            "Pydantic validation error",
            errors=exc.errors(),
            path=request.url.path,
        )
        details = {
            "errors": [
                ErrorDetail(
                    field=".".join(str(loc) for loc in error["loc"]),
                    message=error["msg"],
                    code=error["type"],
                ).model_dump()
                for error in exc.errors()
            ]
        }
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=ErrorResponse(
                error="ValidationError",
                error_code="VALIDATION_ERROR",
                message="Data validation failed",
                details=details,
                request_id=request.headers.get("X-Request-ID"),
            ).model_dump(),
        )

    @app.exception_handler(Exception)
    async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception(
            "Unhandled exception",
            error_type=type(exc).__name__,
            message=str(exc),
            path=request.url.path,
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=ErrorResponse(
                error="InternalServerError",
                error_code="INTERNAL_ERROR",
                message="An unexpected error occurred",
                request_id=request.headers.get("X-Request-ID"),
            ).model_dump(),
        )


# --- Utility Functions ---

def raise_not_found(resource: str, identifier: Any) -> None:
    """Raise a NotFoundException."""
    raise NotFoundException(resource, identifier)


def raise_conflict(message: str, details: dict[str, Any] | None = None) -> None:
    """Raise a ConflictException."""
    raise ConflictException(message, details)


def raise_unauthorized(message: str = "Unauthorized", details: dict[str, Any] | None = None) -> None:
    """Raise an UnauthorizedException."""
    raise UnauthorizedException(message, details)


def raise_forbidden(message: str = "Forbidden", details: dict[str, Any] | None = None) -> None:
    """Raise a ForbiddenException."""
    raise ForbiddenException(message, details)


def raise_rate_limit(message: str = "Rate limit exceeded", retry_after: int = 60) -> None:
    """Raise a RateLimitException."""
    raise RateLimitException(message, retry_after)
