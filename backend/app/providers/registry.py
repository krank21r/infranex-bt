"""
Provider registry: maps provider names to adapter classes.

Adding a real provider is a two-step change:
  1. Implement the :class:`~app.providers.base.GPUProvider` protocol
     in a new module under ``app/providers``.
  2. Add a key -> class mapping here.

The deployment and approval services resolve the active provider
exclusively through this registry, so no service-layer change is
needed when a new backend is added.
"""
import logging
import os

from app.providers.base import GPUProvider, ProductionProvider
from app.providers.e2e import E2EProvider
from app.providers.mock import MockProvider
from app.providers.runpod import RunPodProvider
from app.providers.tensordock import TensorDockProvider
from app.providers.vastai import VastAIProvider

logger = logging.getLogger(__name__)

# name -> adapter class. "mock" is the safe default; "production" is a
# guarded stub so an unresolved real mode fails loudly, not silently.
PROVIDER_REGISTRY: dict[str, type[GPUProvider]] = {
    "mock": MockProvider,
    "production": ProductionProvider,
    "runpod": RunPodProvider,
    "vastai": VastAIProvider,
    "tensordock": TensorDockProvider,
    "e2e": E2EProvider,
}


def default_mode() -> str:
    """Resolve the active deployment mode from config/env."""
    return (os.getenv("DEPLOYMENT_MODE") or "mock").lower()


def get_provider(mode: str | None = None) -> GPUProvider:
    """Resolve and instantiate the active provider by name."""
    resolved = (mode or default_mode()).lower()
    if resolved not in PROVIDER_REGISTRY:
        logger.warning(
            "Unknown DEPLOYMENT_MODE=%r; falling back to 'mock'", resolved
        )
        resolved = "mock"
    return PROVIDER_REGISTRY[resolved]()  # type: ignore[call-arg]
