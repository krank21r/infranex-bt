"""
GPU provider adapters for the Infranex BT deployment engine.

Exposes the protocol, the registry resolver, and every concrete
adapter so callers can `from app.providers import ...`.
"""
from app.providers.base import (
    GPUProvider,
    ProductionProvider,
    offer_from_deployment,
)
from app.providers.e2e import E2EProvider
from app.providers.mock import MockProvider
from app.providers.registry import PROVIDER_REGISTRY, default_mode, get_provider
from app.providers.runpod import RunPodProvider
from app.providers.tensordock import TensorDockProvider
from app.providers.vastai import VastAIProvider

__all__ = [
    "PROVIDER_REGISTRY",
    "E2EProvider",
    "GPUProvider",
    "MockProvider",
    "ProductionProvider",
    "RunPodProvider",
    "TensorDockProvider",
    "VastAIProvider",
    "default_mode",
    "get_provider",
    "offer_from_deployment",
]
