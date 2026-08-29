"""
TensorDock provider adapter (https://tensordock.com).

Talks to the TensorDock Market API. The API key is read from the
``TENSORDOCK_API_KEY`` environment variable (and the optional
``TENSORDOCK_API_SECRET``) unless passed explicitly.

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

TENSORDOCK_API_URL = "https://api.tensordock.com/market/api/v1"


class TensorDockProvider:
    """GPU instance management via the TensorDock Market API."""

    name = "tensordock"

    def __init__(
        self,
        api_key: Optional[str] = None,
        api_secret: Optional[str] = None,
        client: Optional[httpx.Client] = None,
    ) -> None:
        self.api_key = api_key or os.getenv("TENSORDOCK_API_KEY")
        self.api_secret = api_secret or os.getenv("TENSORDOCK_API_SECRET")
        self._client = client
        if not self.api_key:
            logger.warning(
                "TENSORDOCK_API_KEY not set; TensorDockProvider network calls will fail"
            )

    # ---------- networking ----------

    @property
    def client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(timeout=30.0)
        return self._client

    def _headers(self) -> Dict[str, str]:
        # TensorDock auth is key + secret pairs on each request.
        headers: Dict[str, str] = {"Authorization": f"Bearer {self.api_key}"}
        if self.api_secret:
            headers["X-API-Secret"] = self.api_secret
        return headers

    def _request(self, method: str, path: str, **kwargs: Any) -> Dict[str, Any]:
        resp = self.client.request(
            method,
            f"{TENSORDOCK_API_URL}{path}",
            headers=self._headers(),
            **kwargs,
        )
        resp.raise_for_status()
        return resp.json()

    # ---------- API surface ----------

    def search_offers(self, params: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """List available TensorDock GPU offers."""
        data = self._request("GET", "/search", params=params or {})
        return data.get("offers", []) or []

    def create_instance(
        self,
        gpu_model: str,
        region: str,
        image: str = "ubuntu:22.04",
        vcpu: int = 4,
        ram: int = 16,
        storage: int = 50,
    ) -> Dict[str, Any]:
        """Rent a GPU instance on the TensorDock marketplace."""
        body = {
            "gpu_model": gpu_model,
            "region": region,
            "image": image,
            "vcpu": vcpu,
            "ram": ram,
            "storage": storage,
        }
        return self._request("POST", "/rent", json=body)

    def start_instance(self, instance_id: str) -> Dict[str, Any]:
        return self._request("POST", f"/start/{instance_id}")

    def stop_instance(self, instance_id: str) -> Dict[str, Any]:
        return self._request("POST", f"/stop/{instance_id}")

    def destroy_instance(self, instance_id: str) -> Dict[str, Any]:
        return self._request("POST", f"/destroy/{instance_id}")

    # ---------- GPUProvider protocol ----------

    async def provision_server(self, deployment: Any) -> Server:
        offer = offer_from_deployment(deployment)
        result = self.create_instance(
            gpu_model=offer.get("gpu_model_name") or offer.get("gpu_model_id") or "rtx4090",
            region=offer.get("region") or "us-east",
        )
        return Server(
            provider_instance_id=str(result.get("id") or result.get("instance_id")),
            ip_address=result.get("ip"),
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
