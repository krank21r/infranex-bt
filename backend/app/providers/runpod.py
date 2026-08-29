"""
RunPod provider adapter (https://runpod.io).

Talks to the RunPod GraphQL API. The API key is read from the
``RUNPOD_API_KEY`` environment variable unless passed explicitly.

All network access goes through ``self.client`` (an ``httpx.Client``),
which is injectable so tests can mock the external calls without
touching the real API.
"""
import logging
import os
from typing import Any, Dict, List, Optional

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.models.deployment import Server
from app.providers.base import offer_from_deployment

logger = logging.getLogger(__name__)

RUNPOD_API_URL = "https://api.runpod.io/graphql"


class RunPodProvider:
    """GPU pod management via the RunPod GraphQL API."""

    name = "runpod"

    def __init__(
        self,
        api_key: Optional[str] = None,
        client: Optional[httpx.Client] = None,
    ) -> None:
        self.api_key = api_key or os.getenv("RUNPOD_API_KEY")
        self._client = client
        if not self.api_key:
            logger.warning(
                "RUNPOD_API_KEY not set; RunPodProvider network calls will fail"
            )

    @property
    def client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(timeout=30.0)
        return self._client

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        retry=retry_if_exception_type((httpx.TimeoutException, RuntimeError)),
        reraise=True,
    )
    def _graphql(self, query: str, variables: Dict[str, Any]) -> Dict[str, Any]:
        """POST a GraphQL query and return the `data` payload.

        Raises ``RuntimeError`` on transport errors or GraphQL errors.
        Retries on timeout and rate-limit responses.
        """
        try:
            resp = self.client.post(
                RUNPOD_API_URL,
                json={"query": query, "variables": variables},
                headers=self._headers(),
            )
            if resp.status_code == 429:
                logger.warning("RunPod rate limit hit, retrying...")
                raise RuntimeError("Rate limited")
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 429:
                logger.warning("RunPod rate limit hit, retrying...")
                raise RuntimeError("Rate limited")
            raise
        except httpx.TimeoutException:
            logger.warning("RunPod API timeout, retrying...")
            raise
        payload = resp.json()
        if payload.get("errors"):
            errors = payload["errors"]
            msg = errors[0].get("message", str(errors)) if errors else str(errors)
            if "insufficient" in msg.lower() or "funds" in msg.lower():
                raise RuntimeError(f"Insufficient funds: {msg}")
            if "invalid" in msg.lower() and "gpu" in msg.lower():
                raise ValueError(f"Invalid GPU type: {msg}")
            raise RuntimeError(f"RunPod GraphQL error: {msg}")
        return payload.get("data", {})

    def get_gpu_types(self) -> List[Dict[str, Any]]:
        """List available RunPod GPU types."""
        query = """
        query GpuTypes {
          gpuTypes { id displayName memoryInGb secureCloudPrice perGpuPrice }
        }
        """
        data = self._graphql(query, {})
        return data.get("gpuTypes", []) or []

    def list_gpu_types(self) -> List[Dict[str, Any]]:
        """Alias for ``get_gpu_types``."""
        return self.get_gpu_types()

    def create_pod(
        self,
        gpu_type_id: str,
        name: str = "infranex-bt",
        image: str = "runpod/pytorch:latest",
        env: Optional[Dict[str, str]] = None,
        gpu_count: int = 1,
    ) -> Dict[str, Any]:
        """Create (and auto-deploy) a pod. Returns the pod dict."""
        query = """
        mutation Deploy($input: PodFindAndDeployOnDemandInput!) {
          podFindAndDeployOnDemand(input: $input) { id name desiredStatus }
        }
        """
        variables = {
            "input": {
                "gpuTypeId": gpu_type_id,
                "name": name,
                "imageName": image,
                "gpuCount": gpu_count,
                "env": [{"key": k, "value": v} for k, v in (env or {}).items()],
                "containerDiskInGb": 50,
            }
        }
        data = self._graphql(query, variables)
        return data.get("podFindAndDeployOnDemand", {}) or {}

    def start_pod(self, pod_id: str) -> Dict[str, Any]:
        """Resume a stopped pod."""
        query = """
        mutation Resume($podId: String!) { podResume(podId: $podId) { id desiredStatus } }
        """
        data = self._graphql(query, {"podId": pod_id})
        return data.get("podResume", {}) or {}

    def stop_pod(self, pod_id: str) -> Dict[str, Any]:
        """Suspend a running pod."""
        query = """
        mutation Suspend($podId: String!) { podSuspend(podId: $podId) { id desiredStatus } }
        """
        data = self._graphql(query, {"podId": pod_id})
        return data.get("podSuspend", {}) or {}

    def destroy_pod(self, pod_id: str) -> Dict[str, Any]:
        """Terminate a pod and release the GPU."""
        query = """
        mutation Terminate($podId: String!) { podTerminate(podId: $podId) }
        """
        data = self._graphql(query, {"podId": pod_id})
        return data.get("podTerminate", {}) or {}

    def get_pod_status(self, pod_id: str) -> Dict[str, Any]:
        """Query the current status of a pod from RunPod."""
        query = """
        query Pod($podId: String!) {
          pod(podId: $podId) {
            id desiredStatus actualStatus ip port
            gpuCount gpuTypeId containerDiskInGb
          }
        }
        """
        data = self._graphql(query, {"podId": pod_id})
        return data.get("pod", {}) or {}

    async def provision_server(self, deployment: Any) -> Server:
        offer = offer_from_deployment(deployment)
        gpu_type_id = offer.get("provider_offer_id") or offer.get("id")
        if not gpu_type_id:
            raise ValueError("RunPod provisioning requires a gpu_type_id in the offer")
        pod = self.create_pod(
            gpu_type_id=str(gpu_type_id),
            name=f"infranex-{getattr(deployment, 'id', 'x')}",
        )
        return Server(
            provider_instance_id=pod.get("id"),
            ip_address=pod.get("ip"),
            ssh_port=22,
            status="provisioning",
            provider_id=offer.get("provider_id"),
            region=offer.get("region"),
            gpu_model=offer.get("gpu_model_name"),
            deployment_id=getattr(deployment, "id", None),
        )

    def setup_server(self, server: Server) -> bool:
        server.status = "provisioned"
        return bool(server.provider_instance_id)

    def deploy_miner(self, server: Server, config: Dict[str, Any]) -> bool:
        if not server.provider_instance_id:
            return False
        server.status = "started"
        return True

    def stop_miner(self, server: Server) -> bool:
        if not server.provider_instance_id:
            return False
        self.stop_pod(server.provider_instance_id)
        server.status = "stopped"
        return True

    def terminate_server(self, server: Server) -> bool:
        if not server.provider_instance_id:
            return False
        self.destroy_pod(server.provider_instance_id)
        server.status = "terminated"
        return True

    def get_status(self, server: Server) -> Dict[str, Any]:
        if not server.provider_instance_id:
            return {
                "provider": self.name,
                "provider_instance_id": None,
                "status": "unknown",
            }
        try:
            pod = self.get_pod_status(server.provider_instance_id)
            return {
                "provider": self.name,
                "provider_instance_id": server.provider_instance_id,
                "status": pod.get("actualStatus") or pod.get("desiredStatus") or server.status,
            }
        except Exception as exc:
            logger.warning(
                "Failed to fetch RunPod status for %s: %s",
                server.provider_instance_id,
                exc,
            )
            return {
                "provider": self.name,
                "provider_instance_id": server.provider_instance_id,
                "status": server.status,
            }
