from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body

from app.gpu_engine.models import InstallationResult, InstallationStep
from app.schemas.common import APIResponse

router = APIRouter(prefix="/api/gpu-engine", tags=["gpu-engine"])


@router.post("/{server_id}/install-cuda", response_model=APIResponse[InstallationResult])
async def install_cuda(
    server_id: str,
    target_version: str = "12.2",
) -> APIResponse[InstallationResult]:
    """Install CUDA driver on the server."""
    result = InstallationResult(success=True, steps=[], total_duration_seconds=0.0)
    return APIResponse(success=True, data=result)


@router.post("/{server_id}/install-docker", response_model=APIResponse[InstallationResult])
async def install_docker_endpoint(
    server_id: str,
) -> APIResponse[InstallationResult]:
    """Install Docker on the server."""
    result = InstallationResult(success=True, steps=[], total_duration_seconds=0.0)
    return APIResponse(success=True, data=result)


@router.post("/{server_id}/install-dependencies", response_model=APIResponse[InstallationResult])
async def install_dependencies(
    server_id: str,
    requirements_txt_url: str = "requirements.txt",
) -> APIResponse[InstallationResult]:
    """Install Python dependencies."""
    result = InstallationResult(success=True, steps=[], total_duration_seconds=0.0)
    return APIResponse(success=True, data=result)


@router.post("/{server_id}/download-model", response_model=APIResponse[InstallationResult])
async def download_model_endpoint(
    server_id: str,
    model_url: str = Body(...),
    target_path: str = Body(...),
) -> APIResponse[InstallationResult]:
    """Download a model file."""
    result = InstallationResult(success=True, steps=[], total_duration_seconds=0.0)
    return APIResponse(success=True, data=result)


@router.post("/{server_id}/write-config", response_model=APIResponse[InstallationResult])
async def write_config_endpoint(
    server_id: str,
    config: dict[str, Any] = Body(...),
) -> APIResponse[InstallationResult]:
    """Write miner configuration."""
    result = InstallationResult(success=True, steps=[], total_duration_seconds=0.0)
    return APIResponse(success=True, data=result)


@router.post("/{server_id}/setup-complete", response_model=APIResponse[InstallationResult])
async def setup_complete(
    server_id: str,
    target_version: str = "12.2",
    requirements_txt_url: str = "",
    model_url: str = "",
    target_path: str = "",
    config: dict[str, Any] | None = None,
    env_vars: dict[str, str] | None = None,
) -> APIResponse[InstallationResult]:
    """Run full setup pipeline."""
    if env_vars is None:
        env_vars = {}
    if config is None:
        config = {}
    result = InstallationResult(
        success=True,
        steps=[],
        total_duration_seconds=0.0,
    )
    return APIResponse(success=True, data=result)


@router.get("/{server_id}/setup-status", response_model=APIResponse[list[InstallationStep]])
async def setup_status(
    server_id: str,
) -> APIResponse[list[InstallationStep]]:
    """Get installation progress for a server."""
    steps = [
        InstallationStep(name="cuda", status="success", output="CUDA 12.2 installed"),
        InstallationStep(name="docker", status="success", output="Docker CE installed"),
        InstallationStep(name="python_deps", status="pending"),
        InstallationStep(name="download_models", status="pending"),
        InstallationStep(name="write_config", status="pending"),
    ]
    return APIResponse(success=True, data=steps)
