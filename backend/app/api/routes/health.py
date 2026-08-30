"""
Health check endpoints.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.config import settings
from app.api.deps import get_db
from app.schemas.common import HealthCheck, ReadinessCheck, LivenessCheck

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthCheck)
async def health_check(request: Request) -> HealthCheck:
    return HealthCheck(
        status="healthy",
        timestamp=datetime.now(timezone.utc),
        version="1.0.0",
        environment=settings.APP_ENV,
        deployment_mode=settings.DEPLOYMENT_MODE,
    )


@router.get("/health/live", response_model=LivenessCheck)
async def liveness_check(request: Request) -> LivenessCheck:
    return LivenessCheck(alive=True, timestamp=datetime.now(timezone.utc))


@router.get("/health/ready", response_model=ReadinessCheck)
async def readiness_check(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> ReadinessCheck:
    checks: dict = {}
    all_ready = True

    try:
        result = await db.execute(text("SELECT 1"))
        result.scalar()
        checks["database"] = {"status": "healthy"}
    except Exception as e:
        checks["database"] = {"status": "unhealthy", "error": str(e)}
        all_ready = False

    if settings.REDIS_URL:
        try:
            import redis.asyncio as redis
            r = redis.from_url(settings.REDIS_URL)
            await r.ping()
            await r.close()
            checks["redis"] = {"status": "healthy"}
        except Exception as e:
            checks["redis"] = {"status": "unhealthy", "error": str(e)}
            all_ready = False
    else:
        checks["redis"] = {"status": "not_configured"}

    return ReadinessCheck(ready=all_ready, checks=checks)


@router.get("/health/db-test")
async def db_test(request: Request) -> dict:
    """Direct database connection test."""
    from sqlalchemy import text
    from app.core.database import db_manager
    
    result = {"steps": []}
    
    try:
        result["steps"].append("Getting async engine...")
        engine = db_manager.get_async_engine()
        result["steps"].append(f"Engine created: {engine.url}")
        
        result["steps"].append("Connecting to database...")
        async with engine.connect() as conn:
            result["steps"].append("Connected!")
            result["steps"].append("Executing SELECT 1...")
            await conn.execute(text("SELECT 1"))
            result["steps"].append("Query executed successfully!")
        result["status"] = "healthy"
    except Exception as e:
        result["status"] = "error"
        result["error"] = str(e)
        result["error_type"] = type(e).__name__
    
    return result


@router.get("/health/details")
async def health_details(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Detailed system health status."""
    import sys
    import platform
    import time
    
    db_status = "unknown"
    db_latency = 0
    db_error = None
    try:
        start = time.time()
        await db.execute(text("SELECT 1"))
        db_latency = (time.time() - start) * 1000
        db_status = "healthy"
    except Exception as e:
        db_status = f"unhealthy: {type(e).__name__}"
        db_error = str(e)[:500]

    return {
        "service": settings.APP_NAME,
        "version": "1.0.0",
        "environment": settings.APP_ENV,
        "deployment_mode": settings.DEPLOYMENT_MODE,
        "python_version": sys.version,
        "platform": platform.platform(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "dependencies": {
            "database": db_status,
            "database_error": db_error,
            "database_latency_ms": round(db_latency, 2),
            "supabase_url": (settings.SUPABASE_URL[:50] + "...") if settings.SUPABASE_URL else "not_configured",
            "redis_url": settings.REDIS_URL or "not_configured",
            "bittensor_network": settings.BITTENSOR_NETWORK,
            "database_url_prefix": (settings.DATABASE_URL[:30] + "...") if settings.DATABASE_URL else "not_set",
            "pooler_url_prefix": (settings.DATABASE_POOLER_URL[:30] + "...") if settings.DATABASE_POOLER_URL else "not_set",
            "effective_db_url_prefix": (settings.effective_database_url[:30] + "...") if settings.effective_database_url else "not_set",
        },
        "config": {
            "debug": settings.DEBUG,
            "log_level": settings.LOG_LEVEL,
            "cors_origins": settings.cors_origins_list,
            "default_page_size": settings.DEFAULT_PAGE_SIZE,
            "max_page_size": settings.MAX_PAGE_SIZE,
        },
    }
