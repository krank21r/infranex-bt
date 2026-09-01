"""
Deployment-related Pydantic schemas.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.common import BaseSchema, IDMixin, TimestampMixin


class DeploymentCreate(BaseSchema):
    netuid: int = Field(description="Target subnet netuid")
    gpu_model_id: str | None = Field(default=None, description="Preferred GPU model")
    gpu_name: str | None = Field(default=None, description="GPU model name")
    provider_id: str | None = Field(default=None, description="Preferred provider")
    opportunity_score_id: str | None = Field(default=None)
    compatibility_test_id: str | None = Field(default=None)
    hotkey_address: str | None = Field(default=None, description="Validator/miner hotkey")
    deployment_config: dict[str, Any] | None = Field(default_factory=dict)
    estimated_monthly_cost: float | None = None
    estimated_monthly_revenue: float | None = None
    currency: str | None = Field(default="INR")


class DeploymentResponse(BaseSchema, IDMixin, TimestampMixin):
    id: str
    user_id: str | None = None
    netuid: int
    subnet_name: str | None = None
    gpu_model_id: str | None = None
    gpu_name: str | None = None
    provider_id: str | None = None
    provider_name: str | None = None
    opportunity_score_id: str | None = None
    compatibility_test_id: str | None = None
    status: str
    server_id: str | None = None
    hotkey_address: str | None = None
    deployment_config: dict[str, Any] | None = None
    estimated_monthly_cost: float | None = None
    estimated_monthly_revenue: float | None = None
    currency: str | None = "INR"
    approved_at: datetime | None = None
    provisioned_at: datetime | None = None
    started_at: datetime | None = None
    stopped_at: datetime | None = None
    terminated_at: datetime | None = None
    error_message: str | None = None
    extra_metadata: dict[str, Any] = Field(default_factory=dict)


class ServerResponse(BaseSchema, IDMixin, TimestampMixin):
    deployment_id: str | None = None
    provider_id: str | None = None
    provider_instance_id: str | None = None
    name: str | None = None
    region: str | None = None
    status: str | None = None
    ip_address: str | None = None
    ssh_port: int | None = None
    gpu_model: str | None = None
    gpu_count: int = 1
    vram_gb: float | None = None
    ram_gb: float | None = None
    cpu_cores: int | None = None
    storage_gb: float | None = None
    hourly_cost: float | None = None
    currency: str = "USD"
    extra_metadata: dict[str, Any] = Field(default_factory=dict)
    provisioned_at: datetime | None = None
    terminated_at: datetime | None = None


class ApprovalGateInput(BaseModel):
    action_type: str = Field(description="Action to classify for approval")
    approver_user_id: str | None = Field(default=None, description="User requesting approval")
    decision_note: str | None = Field(default=None, max_length=2000)


class TerminateInput(BaseModel):
    reason: str | None = Field(default=None, max_length=2000)
    force: bool = Field(default=False)
