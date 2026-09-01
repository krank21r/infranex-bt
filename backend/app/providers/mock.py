"""
In-memory provider for dev + tests (extracted from deployment_service.py).

Simulates the full server lifecycle without touching any external API:
    provision -> setup -> deploy_miner -> stop_miner -> terminate
"""
import asyncio
import logging
import time
from typing import Any

from app.models.deployment import Server
from app.providers.base import offer_from_deployment

logger = logging.getLogger(__name__)


class MockProvider:
    """Deterministic, offline provider. Safe default for `DEPLOYMENT_MODE=mock`."""

    name = "mock"

    def __init__(self) -> None:
        self._seq = 0
        self._servers: dict[str, dict[str, Any]] = {}

    def _next_provider_id(self) -> str:
        self._seq += 1
        return f"mock-srv-{self._seq:04d}"

    async def provision_server(self, deployment: Any) -> Server:
        await asyncio.sleep(0.05)
        offer = offer_from_deployment(deployment)
        provider_id = self._next_provider_id()
        server = Server(
            provider_instance_id=provider_id,
            ip_address="0.0.0.0",
            ssh_port=22,
            status="provisioning",
            provider_id=offer.get("provider_id"),
            gpu_model=offer.get("gpu_model_name"),
            region=offer.get("region"),
            deployment_id=getattr(deployment, "id", None),
        )
        self._servers[provider_id] = {"miner_running": False}
        return server

    def setup_server(self, server: Server) -> bool:
        time.sleep(0.02)
        if server.provider_instance_id not in self._servers:
            return False
        server.status = "provisioned"
        return True

    def deploy_miner(self, server: Server, config: dict[str, Any]) -> bool:
        time.sleep(0.05)
        state = self._servers.get(server.provider_instance_id)
        if state is None:
            return False
        state["miner_running"] = True
        state["config"] = config
        server.status = "started"
        return True

    def stop_miner(self, server: Server) -> bool:
        time.sleep(0.05)
        state = self._servers.get(server.provider_instance_id)
        if state is None:
            return False
        state["miner_running"] = False
        server.status = "stopped"
        return True

    def terminate_server(self, server: Server) -> bool:
        time.sleep(0.02)
        self._servers.pop(server.provider_instance_id, None)
        server.status = "terminated"
        return True

    def get_status(self, server: Server) -> dict[str, Any]:
        state = self._servers.get(server.provider_instance_id, {})
        return {
            "provider": self.name,
            "provider_instance_id": server.provider_instance_id,
            "status": server.status,
            "miner_running": state.get("miner_running", False),
        }
