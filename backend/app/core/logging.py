"""
Structured logging configuration using structlog.
"""
import sys
import logging
import time
import structlog
from typing import Any, Dict
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings


def configure_logging() -> None:
    """Configure structured logging for the application."""
    
    # Configure standard library logging
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    )
    
    # Configure structlog
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.UnicodeDecoder(),
            # Add custom fields
            add_app_context,
            # Render as JSON for production, console for development
            structlog.processors.JSONRenderer() if settings.APP_ENV == "production" 
            else structlog.dev.ConsoleRenderer(colors=True),
        ],
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )


def add_app_context(logger: Any, method_name: str, event_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Add application context to log entries."""
    event_dict["app"] = settings.APP_NAME
    event_dict["env"] = settings.APP_ENV
    event_dict["deployment_mode"] = settings.DEPLOYMENT_MODE
    return event_dict


def get_logger(name: str = None) -> structlog.BoundLogger:
    """Get a structured logger instance."""
    return structlog.get_logger(name)


# --- Request Logging Middleware ---


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Middleware for logging HTTP requests and responses."""
    
    async def dispatch(self, request: Request, call_next):
        start_time = time.time()
        
        # Generate request ID if not present
        request_id = request.headers.get("X-Request-ID")
        if not request_id:
            import uuid
            request_id = str(uuid.uuid4())[:8]
        
        # Add request ID to request state
        request.state.request_id = request_id
        
        # Log request
        logger = get_logger("http.request")
        logger.info(
            "Request started",
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            query_params=dict(request.query_params),
            client_ip=request.client.host if request.client else None,
            user_agent=request.headers.get("User-Agent"),
        )
        
        try:
            response = await call_next(request)
            
            # Calculate duration
            duration_ms = (time.time() - start_time) * 1000
            
            # Log response
            logger.info(
                "Request completed",
                request_id=request_id,
                method=request.method,
                path=request.url.path,
                status_code=response.status_code,
                duration_ms=round(duration_ms, 2),
            )
            
            # Add request ID to response headers
            response.headers["X-Request-ID"] = request_id
            
            return response
            
        except Exception as e:
            duration_ms = (time.time() - start_time) * 1000
            logger.error(
                "Request failed",
                request_id=request_id,
                method=request.method,
                path=request.url.path,
                error=str(e),
                duration_ms=round(duration_ms, 2),
            )
            raise


# --- Database Query Logging ---

def log_query(query: str, params: Dict[str, Any] = None, duration_ms: float = None) -> None:
    """Log a database query."""
    logger = get_logger("db.query")
    logger.debug(
        "Database query",
        query=query,
        params=params,
        duration_ms=duration_ms,
    )


def log_slow_query(query: str, params: Dict[str, Any] = None, duration_ms: float = None, threshold_ms: float = 1000) -> None:
    """Log a slow database query."""
    if duration_ms and duration_ms > threshold_ms:
        logger = get_logger("db.slow_query")
        logger.warning(
            "Slow database query",
            query=query,
            params=params,
            duration_ms=duration_ms,
            threshold_ms=threshold_ms,
        )


# --- Audit Logging ---

def log_audit(
    action: str,
    resource: str,
    resource_id: str = None,
    user_id: str = None,
    details: Dict[str, Any] = None,
    success: bool = True,
) -> None:
    """Log an audit event."""
    logger = get_logger("audit")
    logger.info(
        "Audit event",
        action=action,
        resource=resource,
        resource_id=resource_id,
        user_id=user_id,
        details=details or {},
        success=success,
    )


# --- Performance Logging ---

def log_performance(
    operation: str,
    duration_ms: float,
    metadata: Dict[str, Any] = None,
) -> None:
    """Log a performance metric."""
    logger = get_logger("performance")
    logger.info(
        "Performance metric",
        operation=operation,
        duration_ms=duration_ms,
        metadata=metadata or {},
    )


# --- Security Logging ---

def log_security_event(
    event_type: str,
    user_id: str = None,
    ip_address: str = None,
    details: Dict[str, Any] = None,
    severity: str = "info",
) -> None:
    """Log a security event."""
    logger = get_logger("security")
    log_method = getattr(logger, severity.lower(), logger.info)
    log_method(
        "Security event",
        event_type=event_type,
        user_id=user_id,
        ip_address=ip_address,
        details=details or {},
    )