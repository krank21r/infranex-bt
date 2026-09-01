from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.schemas.auth import User
from app.schemas.common import APIResponse
from app.schemas.user_miner import (
    HotkeyValidationRequest,
    HotkeyValidationResponse,
    UserMinerCreate,
    UserMinerResponse,
    UserMinerUpdate,
)
from app.services.hotkey_validator import get_hotkey_validator
from app.services.subnet_service import SubnetService
from app.services.user_miner_service import UserMinerService

router = APIRouter(prefix="/miners", tags=["miners"])


def _subnet_name_for_netuid(subnet: object | None) -> str | None:
    if subnet is None:
        return None
    return getattr(subnet, "name", None)


@router.get("/my", response_model=APIResponse[list[UserMinerResponse]])
async def list_my_miners(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> APIResponse[list[UserMinerResponse]]:
    service = UserMinerService(db)
    items = await service.list_user_miners(user.id)
    return APIResponse(success=True, data=items)


@router.post("/register", response_model=APIResponse[UserMinerResponse])
async def register_miner(
    body: UserMinerCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> APIResponse[UserMinerResponse]:
    validator = get_hotkey_validator()
    info = await validator.validate_hotkey_onchain(body.hotkey, body.netuid)
    if not info.found:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=info.error or "hotkey_not_registered_in_subnet",
        )
    subnet = await SubnetService(db).get_subnet(body.netuid)
    subnet_name = _subnet_name_for_netuid(subnet)
    service = UserMinerService(db)
    record = await service.register_miner(
        user_id=user.id,
        data=body,
        subnet_name=subnet_name,
        uid=info.uid,
        incentive=info.incentive,
    )
    return APIResponse(success=True, data=record)


@router.get("/my/{miner_id}", response_model=APIResponse[UserMinerResponse])
async def get_my_miner(
    miner_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> APIResponse[UserMinerResponse]:
    service = UserMinerService(db)
    record = await service.get_miner(user.id, miner_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="miner_not_found")
    return APIResponse(success=True, data=record)


@router.patch("/my/{miner_id}", response_model=APIResponse[UserMinerResponse])
async def update_my_miner(
    miner_id: str,
    body: UserMinerUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> APIResponse[UserMinerResponse]:
    service = UserMinerService(db)
    record = await service.update_miner(user.id, miner_id, body)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="miner_not_found")
    return APIResponse(success=True, data=record)


@router.delete("/my/{miner_id}", response_model=APIResponse[dict])
async def delete_my_miner(
    miner_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    service = UserMinerService(db)
    ok = await service.delete_miner(user.id, miner_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="miner_not_found")
    return APIResponse(success=True, data={"id": miner_id, "deleted": True})


@router.post("/validate-hotkey", response_model=HotkeyValidationResponse)
async def validate_hotkey(
    body: HotkeyValidationRequest,
) -> HotkeyValidationResponse:
    validator = get_hotkey_validator()
    info = await validator.validate_hotkey_onchain(body.hotkey, body.netuid)
    return HotkeyValidationResponse(
        valid=info.found,
        on_chain=info.found,
        uid=info.uid,
        netuid=info.netuid,
        hotkey=info.hotkey,
        message="hotkey_found" if info.found else info.error,
        incentive=info.incentive,
        trust=info.trust,
        consensus=info.consensus,
        rank=info.rank,
        stake=info.stake,
    )
