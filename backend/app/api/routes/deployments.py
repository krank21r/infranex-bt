"""
Deployment lifecycle API.

Endpoints:
  POST   /deployments             - create deployment request
  GET    /deployments             - list deployments
  GET    /deployments/{id}        - deployment detail
  POST   /deployments/{id}/approve    - approve deployment
  POST   /deployments/{id}/provision  - start provisioning
  POST   /deployments/{id}/deploy     - deploy miner
  POST   /deployments/{id}/terminate  - terminate
"""
from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, desc, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_current_user
from app.schemas.auth import User
from app.schemas.common import APIResponse, PaginationMeta
from app.schemas.deployment import (
    DeploymentCreate,
    DeploymentResponse,
    ServerResponse,
    TerminateInput,
)
from app.models import Deployment, Server
from app.services.deployment_service import DeploymentService
from app.deployment.state_machine import DeploymentState

router = APIRouter(prefix="/deployments", tags=["deployments"])


def _to_deployment_response(deployment: Deployment) -> DeploymentResponse:
    return DeploymentResponse(
        id=deployment.id,
        user_id=deployment.user_id,
        netuid=deployment.netuid,
        subnet_name=deployment.subnet_name,
        gpu_model_id=deployment.gpu_model_id,
        gpu_name=deployment.gpu_name,
        provider_id=deployment.provider_id,
        provider_name=deployment.provider_name,
        opportunity_score_id=deployment.opportunity_score_id,
        compatibility_test_id=deployment.compatibility_test_id,
        status=deployment.status,
        server_id=deployment.server_id,
        hotkey_address=deployment.hotkey_address,
        deployment_config=deployment.deployment_config,
        estimated_monthly_cost=deployment.estimated_monthly_cost,
        estimated_monthly_revenue=deployment.estimated_monthly_revenue,
        currency=deployment.currency,
        approved_at=deployment.approved_at,
        provisioned_at=deployment.provisioned_at,
        started_at=deployment.started_at,
        stopped_at=deployment.stopped_at,
        terminated_at=deployment.terminated_at,
        error_message=deployment.error_message,
        extra_metadata=deployment.extra_metadata or {},
        created_at=deployment.created_at,
        updated_at=deployment.updated_at,
    )


def _to_server_response(server: Server) -> ServerResponse:
    return ServerResponse(
        id=server.id,
        deployment_id=server.deployment_id,
        provider_id=server.provider_id,
        provider_instance_id=server.provider_instance_id,
        name=server.name,
        region=server.region,
        status=server.status,
        ip_address=server.ip_address,
        ssh_port=server.ssh_port,
        gpu_model=server.gpu_model,
        gpu_count=server.gpu_count,
        vram_gb=server.vram_gb,
        ram_gb=server.ram_gb,
        cpu_cores=server.cpu_cores,
        storage_gb=server.storage_gb,
        hourly_cost=server.hourly_cost,
        currency=server.currency,
        extra_metadata=server.extra_metadata or {},
        provisioned_at=server.provisioned_at,
        terminated_at=server.terminated_at,
        created_at=server.created_at,
        updated_at=server.updated_at,
    )


@router.post("", response_model=APIResponse[DeploymentResponse])
async def create_deployment(
    body: DeploymentCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    svc = DeploymentService(session)
    deployment = await svc.request_deployment(
        netuid=body.netuid,
        offer={
            "id": body.opportunity_score_id or "unknown",
            "provider_id": body.provider_id,
            "gpu_model_id": body.gpu_model_id,
            "gpu_model_name": body.gpu_name,
            "region": "US",
            "vram_gb": 0.0,
            "ram_gb": 0.0,
            "storage_gb": 0.0,
            "instance_type": "unknown",
            "is_spot": False,
            "hourly_price": float(body.estimated_monthly_cost or 0.0) / 730,
            "currency": body.currency or "USD",
        },
        requirements=(body.deployment_config or {}).get("requirements", {}),
        hotkey_address=body.hotkey_address,
    )
    deployment.user_id = user.id
    await session.flush()
    return APIResponse(success=True, data=_to_deployment_response(deployment))


@router.get("", response_model=APIResponse[list[DeploymentResponse]])
async def list_deployments(
    status: Optional[DeploymentState] = None,
    netuid: Optional[int] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    stmt = select(Deployment).order_by(desc(Deployment.created_at))
    if status is not None:
        stmt = stmt.where(Deployment.status == status.value)
    if netuid is not None:
        stmt = stmt.where(Deployment.netuid == netuid)
    count_q = select(func.count()).select_from(Deployment)
    if status is not None:
        count_q = count_q.where(Deployment.status == status.value)
    if netuid is not None:
        count_q = count_q.where(Deployment.netuid == netuid)
    total = (await session.execute(count_q)).scalar_one()
    stmt = stmt.limit(page_size).offset((page - 1) * page_size)
    rows = (await session.execute(stmt)).scalars().all()
    meta = PaginationMeta(
        page=page,
        page_size=page_size,
        total_items=total,
        total_pages=max(1, (total + page_size - 1) // page_size),
        has_next=page * page_size < total,
        has_prev=page > 1,
    )
    return APIResponse(success=True, data=[_to_deployment_response(r) for r in rows], meta=meta)


@router.get("/{deployment_id}", response_model=APIResponse[DeploymentResponse])
async def get_deployment(
    deployment_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    row = await session.get(Deployment, deployment_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="deployment_not_found"
        )
    return APIResponse(success=True, data=_to_deployment_response(row))


@router.post("/{deployment_id}/approve", response_model=APIResponse[DeploymentResponse])
async def approve_deployment(
    deployment_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    svc = DeploymentService(session)
    try:
        deployment = await svc.approve_deployment(deployment_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from exc
    return APIResponse(success=True, data=_to_deployment_response(deployment))


@router.post("/{deployment_id}/provision", response_model=APIResponse[DeploymentResponse])
async def provision_deployment(
    deployment_id: str,
    body: dict,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    svc = DeploymentService(session)
    offer = body.get("offer") or {}
    try:
        deployment = await svc.provision_server(deployment_id, offer)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from exc
    return APIResponse(success=True, data=_to_deployment_response(deployment))


@router.post("/{deployment_id}/deploy", response_model=APIResponse[DeploymentResponse])
async def deploy_miner(
    deployment_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    svc = DeploymentService(session)
    try:
        deployment = await svc.deploy_miner(deployment_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from exc
    return APIResponse(success=True, data=_to_deployment_response(deployment))


@router.post("/{deployment_id}/terminate", response_model=APIResponse[DeploymentResponse])
async def terminate_deployment(
    deployment_id: str,
    body: TerminateInput = TerminateInput(),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    svc = DeploymentService(session)
    try:
        deployment = await svc.terminate_deployment(
            deployment_id, reason=body.reason, force=body.force
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from exc
    return APIResponse(success=True, data=_to_deployment_response(deployment))
