"""
API routes package initialization.
"""
from app.api.routes.admin import router as admin_router
from app.api.routes.approvals import router as approvals_router
from app.api.routes.auth import router as auth_router
from app.api.routes.cron import router as cron_router
from app.api.routes.cron_migration import router as cron_migration_router
from app.api.routes.deployments import router as deployments_router
from app.api.routes.gpu_install import router as gpu_install_router
from app.api.routes.gpus import router as gpus_router
from app.api.routes.health import router as health_router
from app.api.routes.learning import router as learning_router
from app.api.routes.monitoring import router as monitoring_router
from app.api.routes.opportunities import router as opportunities_router
from app.api.routes.opportunities_v2 import router as opportunities_v2_router
from app.api.routes.optimizer import router as optimizer_router
from app.api.routes.orchestrator import router as orchestrator_router
from app.api.routes.providers import router as providers_router
from app.api.routes.recovery import router as recovery_router
from app.api.routes.strategy import router as strategy_router
from app.api.routes.subnets import router as subnets_router
from app.api.routes.user_miners import router as user_miners_router

__all__ = [
    "admin_router",
    "approvals_router",
    "auth_router",
    "cron_migration_router",
    "cron_router",
    "deployments_router",
    "gpu_install_router",
    "gpus_router",
    "health_router",
    "learning_router",
    "monitoring_router",
    "opportunities_router",
    "opportunities_v2_router",
    "optimizer_router",
    "orchestrator_router",
    "providers_router",
    "recovery_router",
    "strategy_router",
    "subnets_router",
    "user_miners_router",
]
