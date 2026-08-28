"""
API routes package initialization.
"""
from app.api.routes.health import router as health_router
from app.api.routes.subnets import router as subnets_router
from app.api.routes.opportunities import router as opportunities_router
from app.api.routes.gpus import router as gpus_router
from app.api.routes.providers import router as providers_router
from app.api.routes.auth import router as auth_router
from app.api.routes.approvals import router as approvals_router
from app.api.routes.cron import router as cron_router
from app.api.routes.cron_migration import router as cron_migration_router

__all__ = [
    "health_router",
    "subnets_router",
    "opportunities_router",
    "gpus_router",
    "providers_router",
    "auth_router",
    "approvals_router",
    "cron_router",
    "cron_migration_router",
]