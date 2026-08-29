"""
Main FastAPI application entry point.
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from app.core.config import settings
from app.core.logging import configure_logging, RequestLoggingMiddleware
from app.core.exceptions import register_exception_handlers
from app.core.database import init_database, close_database
from app.core.startup import validate_environment
from app.api import api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    # Startup
    configure_logging()
    
    # Validate environment before attempting database connection
    validate_environment()
    
    # Initialize database connections
    await init_database()
    
    yield
    
    # Shutdown
    await close_database()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title=settings.APP_NAME,
        description="Infranex BT - Bittensor Subnet Analytics & GPU Marketplace",
        version="1.0.0",
        docs_url="/docs" if settings.DEBUG else None,
        redoc_url="/redoc" if settings.DEBUG else None,
        openapi_url="/openapi.json" if settings.DEBUG else None,
        lifespan=lifespan,
    )
    
    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # Trusted host middleware (security)
    if settings.APP_ENV == "production":
        app.add_middleware(
            TrustedHostMiddleware,
            allowed_hosts=["*.infranex.com", "infranex.com"],
        )
    
    # Request logging middleware
    app.add_middleware(RequestLoggingMiddleware)
    
    # Register exception handlers
    register_exception_handlers(app)
    
    # Include API router
    app.include_router(api_router)
    
    # Root endpoint
    @app.get("/")
    async def root():
        return {
            "name": settings.APP_NAME,
            "version": "1.0.0",
            "description": "Bittensor Subnet Analytics & GPU Marketplace API",
            "docs": "/docs",
            "health": "/api/health",
        }
    
    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG,
        log_level=settings.LOG_LEVEL.lower(),
    )