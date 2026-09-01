from datetime import datetime

from pydantic import Field

from app.schemas.common import BaseSchema, IDMixin


class UserMinerCreate(BaseSchema):
    name: str = Field(min_length=1, max_length=100, description="Display name for the miner")
    hotkey: str = Field(min_length=46, max_length=48, description="Bittensor hotkey ss58 address")
    netuid: int = Field(ge=0, description="Subnet netuid")
    description: str | None = Field(default=None, max_length=1000)
    tags: list[str] | None = Field(default_factory=list)


class UserMinerUpdate(BaseSchema):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=1000)
    tags: list[str] | None = None


class UserMinerResponse(BaseSchema, IDMixin):
    user_id: str
    name: str
    hotkey: str
    netuid: int
    subnet_name: str | None = None
    status: str = "active"
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    total_earnings: float = 0.0
    uptime_percent: float = 100.0
    uid: int | None = None
    incentive: float | None = None
    created_at: datetime
    updated_at: datetime | None = None


class HotkeyValidationRequest(BaseSchema):
    hotkey: str = Field(min_length=1, description="Bittensor hotkey ss58 address")
    netuid: int = Field(ge=0, description="Subnet netuid to verify against")


class HotkeyValidationResponse(BaseSchema):
    valid: bool
    on_chain: bool = False
    uid: int | None = None
    netuid: int | None = None
    hotkey: str | None = None
    message: str
    incentive: float | None = None
    trust: float | None = None
    consensus: float | None = None
    rank: float | None = None
    stake: float | None = None
