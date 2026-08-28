"""
API package initialization.
"""
from fastapi import APIRouter

from app.api.routes import (
    health_router,
    subnets_router,
    opportunities_router,
    gpus_router,
    providers_router,
    auth_router,
    approvals_router,
    cron_router,
    cron_migration_router,
)

from app.core.config import settings

api_router = APIRouter(prefix=settings.API_V1_PREFIX)

api_router.include_router(health_router)
api_router.include_router(subnets_router)
api_router.include_router(opportunities_router)
api_router.include_router(gpus_router)
api_router.include_router(providers_router)
api_router.include_router(auth_router)
api_router.include_router(approvals_router)
api_router.include_router(cron_router)
api_router.include_router(cron_migration_router)

__all__ = ["api_router"]