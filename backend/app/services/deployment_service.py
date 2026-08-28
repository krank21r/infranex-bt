"""
Deployment engine (Phase 7).

Closed-loop "Deploy" stage. Translates a ranked GPU offer + subnet
requirements into a tracked `Deployment` row, gated by a 3-level
approval flow:

    request  ->  approved  ->  provisioning  ->  provisioned  ->  started

Phase 7 scope (min-viable):
  - `DeploymentService.request_deployment(netuid, offer, requirements) -> Deployment`
    Creates a `Deployment` row in the 'requested' state with cost
    projection (monthly = hourly * 730) and a populated
    `deployment_config` JSONB.
  - Provider abstraction: registry pattern. `MockProvider` is the
    default; `ProductionProvider` raises `NotImplementedError` so a
    real adapter can drop in later without service-layer changes.
  - Mode is read from `DEPLOYMENT_MODE` config (default 'mock').

NOT in scope (deferred):
  - `approve_deployment` / `provision_deployment` orchestration flows.
  - Real provider adapter (Vast.ai / RunPod / Lambda Labs).
  - Compatibility-test re-run before provisioning.
  - SSH health check loop.
"""
import logging
import os
from dataclasses import dataclass
from typing import Any, Dict, Optional, Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Deployment, Server

logger = logging.getLogger(__name__)


# Default mode for the deployment engine. Real providers are gated
# behind the production flag — see project feedback on mock-first design.
DEFAULT_DEPLOYMENT_MODE = "mock"
VALID_MODES = {"mock", "production"}


# ---------- provider abstraction ----------


class GPUProvider(Protocol):
    """Minimal interface every provider adapter must implement.

    Phase 7 ships only `MockProvider`. `ProductionProvider` is a
    placeholder; a real adapter (Vast.ai, RunPod, etc.) implements
    the same shape and drops into the registry.
    """

    async def provision_server(
        self,
        deployment: Deployment,
        offer: Dict[str, Any],
    ) -> Server:
        ...


class MockProvider:
    """In-memory provider for dev + tests. Simulates success.

    Creates a `Server` row with status='provisioning' and a stable
    fake `provider_server_id`. The orchestrator is responsible for
    flipping it to 'provisioned' once a real health check passes.
    """

    def __init__(self) -> None:
        self._seq = 0

    def _next_provider_id(self) -> str:
        self._seq += 1
        return f"mock-srv-{self._seq:04d}"

    async def provision_server(
        self,
        deployment: Deployment,
        offer: Dict[str, Any],
    ) -> Server:
        server = Server(
            provider_server_id=self._next_provider_id(),
            ip_address="0.0.0.0",
            ssh_port=22,
            status="provisioning",
            gpu_offer_id=offer.get("id"),
            deployment_id=deployment.id,
        )
        return server


class ProductionProvider:
    """Stub for the real adapter. Phase 7 does not ship this.

    Phase 7 deliberately refuses to ship a real provider — the user
    wants the mock loop closed end-to-end before any money-moving
    code is written. A future pass drops in Vast/RunPod/Lambda by
    implementing the same `provision_server` shape.
    """

    async def provision_server(
        self,
        deployment: Deployment,
        offer: Dict[str, Any],
    ) -> Server:
        raise NotImplementedError(
            "Real provider adapter not yet implemented; ship mock first"
        )


# Registry. Adding a new provider = add a key here + import the class.
PROVIDER_REGISTRY: Dict[str, type] = {
    "mock": MockProvider,
    "production": ProductionProvider,
}


def _get_provider(mode: Optional[str] = None) -> GPUProvider:
    """Resolve the active provider from config + the registry."""
    resolved = (mode or os.getenv("DEPLOYMENT_MODE") or DEFAULT_DEPLOYMENT_MODE).lower()
    if resolved not in PROVIDER_REGISTRY:
        logger.warning(
            "Unknown DEPLOYMENT_MODE=%r; falling back to %r",
            resolved,
            DEFAULT_DEPLOYMENT_MODE,
        )
        resolved = DEFAULT_DEPLOYMENT_MODE
    cls = PROVIDER_REGISTRY[resolved]
    return cls()  # type: ignore[abstract]


# ---------- service ----------


@dataclass(frozen=True)
class CostProjection:
    """Per-hour -> per-month cost projection. Pure helper, no DB."""

    hourly_price: float
    currency: str
    hours_per_month: int = 730

    @property
    def monthly(self) -> float:
        return round(float(self.hourly_price) * self.hours_per_month, 2)


def _build_deployment_config(
    offer: Dict[str, Any],
    requirements: Dict[str, Any],
) -> Dict[str, Any]:
    """Snapshot the inputs that produced this deployment request.

    Stored as JSONB on the Deployment row so the audit trail survives
    even if the offer / requirements change later.
    """
    return {
        "offer": {
            "id": offer.get("id"),
            "provider_id": offer.get("provider_id"),
            "gpu_model_id": offer.get("gpu_model_id"),
            "gpu_model_name": offer.get("gpu_model_name"),
            "region": offer.get("region"),
            "vram_gb": offer.get("vram_gb"),
            "ram_gb": offer.get("ram_gb"),
            "storage_gb": offer.get("storage_gb"),
            "instance_type": offer.get("instance_type"),
            "is_spot": offer.get("is_spot"),
        },
        "requirements": {
            "min_vram_gb": requirements.get("min_vram_gb"),
            "recommended_gpu": requirements.get("recommended_gpu"),
            "python_version": requirements.get("python_version"),
            "docker_required": requirements.get("docker_required"),
            "nvidia_runtime_required": requirements.get("nvidia_runtime_required"),
            "ports": requirements.get("ports") or [],
            "startup_command": requirements.get("startup_command"),
            "miner_command": requirements.get("miner_command"),
        },
    }


class DeploymentService:
    """Closed-loop Deploy stage. Phase 7 ships `request_deployment` only."""

    def __init__(self, db: AsyncSession, mode: Optional[str] = None) -> None:
        self.db = db
        self.mode = (mode or os.getenv("DEPLOYMENT_MODE") or DEFAULT_DEPLOYMENT_MODE).lower()
        # Stash the resolved provider so the same instance is reused
        # across calls within a request (e.g. provision after approve).
        self._provider = _get_provider(self.mode)

    @property
    def provider(self) -> GPUProvider:
        return self._provider

    async def request_deployment(
        self,
        netuid: int,
        offer: Dict[str, Any],
        requirements: Dict[str, Any],
        *,
        hotkey_address: Optional[str] = None,
    ) -> Deployment:
        """Stage 1: create a Deployment row in the 'requested' state.

        Pure orchestration — no provider call yet. Approval + provisioning
        are separate methods (not in Phase 7 scope).
        """
        cost = CostProjection(
            hourly_price=float(offer.get("hourly_price") or 0.0),
            currency=offer.get("currency") or "USD",
        )
        config = _build_deployment_config(offer, requirements)

        deployment = Deployment(
            netuid=netuid,
            status="requested",
            currency=cost.currency,
            estimated_monthly_cost=cost.monthly,
            estimated_monthly_revenue=None,  # filled later by monitor
            deployment_config=config,
            hotkey_address=hotkey_address,
        )
        self.db.add(deployment)
        await self.db.flush()
        return deployment
