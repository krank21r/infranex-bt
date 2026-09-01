"""
API package initialization.
"""
from fastapi import APIRouter

from app.api.routes import (
    approvals_router,
    auth_router,
    cron_migration_router,
    cron_router,
    deployments_router,
    gpu_install_router,
    gpus_router,
    health_router,
    learning_router,
    monitoring_router,
    opportunities_router,
    opportunities_v2_router,
    optimizer_router,
    orchestrator_router,
    providers_router,
    recovery_router,
    strategy_router,
    subnets_router,
    user_miners_router,
)
from app.core.config import settings

api_router = APIRouter(prefix="/api")

api_router.include_router(health_router)
api_router.include_router(subnets_router)
api_router.include_router(gpu_install_router)
api_router.include_router(opportunities_router)
api_router.include_router(opportunities_v2_router)
api_router.include_router(gpus_router)
api_router.include_router(providers_router)
api_router.include_router(auth_router)
api_router.include_router(approvals_router)
api_router.include_router(cron_router)
api_router.include_router(cron_migration_router)
api_router.include_router(monitoring_router)
api_router.include_router(deployments_router)
api_router.include_router(strategy_router)
api_router.include_router(orchestrator_router)
api_router.include_router(optimizer_router)
api_router.include_router(recovery_router)
api_router.include_router(learning_router)
api_router.include_router(user_miners_router)

__all__ = ["api_router"]
