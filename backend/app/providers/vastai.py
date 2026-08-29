"""
Vast.ai provider adapter (https://vast.ai).

Talks to the Vast.ai REST API. The API key is read from the
``VASTAI_API_KEY`` environment variable unless passed explicitly.

All network access goes through ``self.client`` (an ``httpx.Client``),
which is injectable so tests can mock the external calls.
"""
import logging
import os
from typing import Any, Dict, List, Optional

import httpx

from app.models.deployment import Server
from app.providers.base import offer_from_deployment

logger = logging.getLogger(__name__)

VASTAI_API_URL = "https://console.vast.ai/api/v0"


class VastAIProvider:
    """GPU instance management via the Vast.ai REST API."""

    name = "vastai"

    def __init__(
        self,
        api_key: Optional[str] = None,
        client: Optional[httpx.Client] = None,
    ) -> None:
        self.api_key = api_key or os.getenv("VASTAI_API_KEY")
        self._client = client
        if not self.api_key:
            logger.warning(
                "VASTAI_API_KEY not set; VastAIProvider network calls will fail"
            )

    # ---------- networking ----------

    @property
    def client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(timeout=30.0)
        return self._client

    def _headers(self) -> Dict[str, str]:
        # Vast.ai accepts the API key directly as a Bearer token.
        return {"Authorization": f"Bearer {self.api_key}"}

    def _request(self, method: str, path: str, **kwargs: Any) -> Dict[str, Any]:
        resp = self.client.request(
            method,
            f"{VASTAI_API_URL}{path}",
            headers=self._headers(),
            **kwargs,
        )
        resp.raise_for_status()
        return resp.json()

    # ---------- API surface ----------

    def search_offers(
        self,
        query: Optional[Dict[str, Any]] = None,
        order: str = "dph_total",
    ) -> List[Dict[str, Any]]:
        """Search available GPU offers (bundles)."""
        body = {"query": query or {}, "order": order}
        data = self._request("PUT", "/bundles/", json=body)
        return data.get("offers", []) or []

    def create_instance(
        self,
        ask_id: str,
        image: str = "pytorch/pytorch:latest",
        disk: int = 50,
        env: Optional[Dict[str, str]] = None,
        ssh_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Rent an instance from a given offer (`ask_id`)."""
        body: Dict[str, Any] = {
            "client_id": self.api_key,
            "image": image,
            "disk": disk,
            "env": env or {},
            "ssh_key": ssh_key,
        }
        return self._request("POST", f"/asks/{ask_id}/", json=body)

    def start_instance(self, instance_id: str) -> Dict[str, Any]:
        """Start a stopped instance."""
        return self._request(
            "POST", f"/instances/{instance_id}/", json={"state": "running"}
        )

    def stop_instance(self, instance_id: str) -> Dict[str, Any]:
        """Stop a running instance."""
        return self._request(
            "POST", f"/instances/{instance_id}/", json={"state": "stopped"}
        )

    def destroy_instance(self, instance_id: str) -> Dict[str, Any]:
        """Delete an instance and release the GPU."""
        return self._request("DELETE", f"/instances/{instance_id}/")

    # ---------- GPUProvider protocol ----------

    async def provision_server(self, deployment: Any) -> Server:
        offer = offer_from_deployment(deployment)
        ask_id = offer.get("provider_offer_id") or offer.get("id")
        if not ask_id:
            raise ValueError("Vast.ai provisioning requires an ask_id in the offer")
        result = self.create_instance(ask_id=str(ask_id))
        return Server(
            provider_instance_id=str(result.get("id") or result.get("new_contract")),
            ip_address=result.get("ssh_host"),
            ssh_port=result.get("ssh_port", 22),
            status="provisioning",
            provider_id=offer.get("provider_id"),
            region=offer.get("region"),
            gpu_model=offer.get("gpu_model_name"),
            deployment_id=getattr(deployment, "id", None),
        )

    def setup_server(self, server: Server) -> bool:
        if not server.provider_instance_id:
            return False
        server.status = "provisioned"
        return True

    def deploy_miner(self, server: Server, config: Dict[str, Any]) -> bool:
        if not server.provider_instance_id:
            return False
        server.status = "started"
        return True

    def stop_miner(self, server: Server) -> bool:
        if not server.provider_instance_id:
            return False
        self.stop_instance(server.provider_instance_id)
        server.status = "stopped"
        return True

    def terminate_server(self, server: Server) -> bool:
        if not server.provider_instance_id:
            return False
        self.destroy_instance(server.provider_instance_id)
        server.status = "terminated"
        return True

    def get_status(self, server: Server) -> Dict[str, Any]:
        return {
            "provider": self.name,
            "provider_instance_id": server.provider_instance_id,
            "status": server.status,
        }
