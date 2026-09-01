"""
E2E Networks provider adapter (https://www.e2enetworks.com).

Talks to the E2E Networks API. The API token is read from the
``E2E_API_KEY`` environment variable unless passed explicitly.
The project id is read from ``E2E_PROJECT_ID`` (or passed in).

All network access goes through ``self.client`` (an ``httpx.Client``),
which is injectable so tests can mock the external calls.
"""
import logging
import os
from typing import Any

import httpx

from app.models.deployment import Server
from app.providers.base import offer_from_deployment

logger = logging.getLogger(__name__)

E2E_API_URL = "https://api.e2enetworks.com/v1"


class E2EProvider:
    """GPU node management via the E2E Networks API."""

    name = "e2e"

    def __init__(
        self,
        api_key: str | None = None,
        project_id: str | None = None,
        client: httpx.Client | None = None,
    ) -> None:
        self.api_key = api_key or os.getenv("E2E_API_KEY")
        self.project_id = project_id or os.getenv("E2E_PROJECT_ID")
        self._client = client
        if not self.api_key:
            logger.warning("E2E_API_KEY not set; E2EProvider network calls will fail")

    # ---------- networking ----------

    @property
    def client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(timeout=30.0)
        return self._client

    def _headers(self) -> dict[str, str]:
        headers = {"Authorization": f"Bearer {self.api_key}"}
        if self.project_id:
            headers["Project-ID"] = self.project_id
        return headers

    def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        resp = self.client.request(
            method,
            f"{E2E_API_URL}{path}",
            headers=self._headers(),
            **kwargs,
        )
        resp.raise_for_status()
        return resp.json()

    # ---------- API surface ----------

    def list_gpu_plans(self) -> list[dict[str, Any]]:
        """List available E2E GPU plans/sizes."""
        data = self._request("GET", "/compute/gpu-plans")
        return data.get("data", []) or []

    def create_instance(
        self,
        name: str,
        plan_code: str,
        image: str = "ubuntu-2204-gpu",
        region: str = "cnr",
    ) -> dict[str, Any]:
        """Create a GPU node."""
        body = {
            "name": name,
            "plan_code": plan_code,
            "image": image,
            "region": region,
        }
        return self._request("POST", "/compute/nodes", json=body)

    def start_instance(self, instance_id: str) -> dict[str, Any]:
        return self._request("POST", f"/compute/nodes/{instance_id}/start")

    def stop_instance(self, instance_id: str) -> dict[str, Any]:
        return self._request("POST", f"/compute/nodes/{instance_id}/stop")

    def destroy_instance(self, instance_id: str) -> dict[str, Any]:
        return self._request("DELETE", f"/compute/nodes/{instance_id}")

    # ---------- GPUProvider protocol ----------

    async def provision_server(self, deployment: Any) -> Server:
        offer = offer_from_deployment(deployment)
        result = self.create_instance(
            name=f"infranex-{getattr(deployment, 'id', 'x')}",
            plan_code=offer.get("provider_offer_id") or offer.get("instance_type") or "gpu-rtx4090",
            region=offer.get("region") or "cnr",
        )
        node = result.get("data", result)
        return Server(
            provider_instance_id=str(node.get("id") or node.get("node_id")),
            ip_address=node.get("ip_address") or node.get("private_ip"),
            ssh_port=22,
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

    def deploy_miner(self, server: Server, config: dict[str, Any]) -> bool:
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

    def get_status(self, server: Server) -> dict[str, Any]:
        return {
            "provider": self.name,
            "provider_instance_id": server.provider_instance_id,
            "status": server.status,
        }
