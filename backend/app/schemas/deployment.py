"""
Deployment-related Pydantic schemas.
"""
from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel, Field
from datetime import datetime

from app.schemas.common import BaseSchema, TimestampMixin, IDMixin


class DeploymentCreate(BaseSchema):
    netuid: int = Field(description="Target subnet netuid")
    gpu_model_id: Optional[str] = Field(default=None, description="Preferred GPU model")
    provider_id: Optional[str] = Field(default=None, description="Preferred provider")
    opportunity_score_id: Optional[str] = Field(default=None)
    compatibility_test_id: Optional[str] = Field(default=None)
    hotkey_address: Optional[str] = Field(default=None, description="Validator/miner hotkey")
    deployment_config: Optional[dict[str, Any]] = Field(default_factory=dict)
    estimated_monthly_cost: Optional[float] = None
    estimated_monthly_revenue: Optional[float] = None
    currency: Optional[str] = Field(default="INR")


class DeploymentResponse(BaseSchema, IDMixin, TimestampMixin):
    id: str
    user_id: Optional[str] = None
    netuid: int
    subnet_name: Optional[str] = None
    gpu_model_id: Optional[str] = None
    gpu_name: Optional[str] = None
    provider_id: Optional[str] = None
    provider_name: Optional[str] = None
    opportunity_score_id: Optional[str] = None
    compatibility_test_id: Optional[str] = None
    status: str
    server_id: Optional[str] = None
    hotkey_address: Optional[str] = None
    deployment_config: Optional[dict[str, Any]] = None
    estimated_monthly_cost: Optional[float] = None
    estimated_monthly_revenue: Optional[float] = None
    currency: Optional[str] = "INR"
    approved_at: Optional[datetime] = None
    provisioned_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    stopped_at: Optional[datetime] = None
    terminated_at: Optional[datetime] = None
    error_message: Optional[str] = None
    extra_metadata: dict[str, Any] = Field(default_factory=dict)


class ServerResponse(BaseSchema, IDMixin, TimestampMixin):
    deployment_id: Optional[str] = None
    provider_id: Optional[str] = None
    provider_instance_id: Optional[str] = None
    name: Optional[str] = None
    region: Optional[str] = None
    status: Optional[str] = None
    ip_address: Optional[str] = None
    ssh_port: Optional[int] = None
    gpu_model: Optional[str] = None
    gpu_count: int = 1
    vram_gb: Optional[float] = None
    ram_gb: Optional[float] = None
    cpu_cores: Optional[int] = None
    storage_gb: Optional[float] = None
    hourly_cost: Optional[float] = None
    currency: str = "USD"
    extra_metadata: dict[str, Any] = Field(default_factory=dict)
    provisioned_at: Optional[datetime] = None
    terminated_at: Optional[datetime] = None


class ApprovalGateInput(BaseModel):
    action_type: str = Field(description="Action to classify for approval")
    approver_user_id: Optional[str] = Field(default=None, description="User requesting approval")
    decision_note: Optional[str] = Field(default=None, max_length=2000)


class TerminateInput(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=2000)
    force: bool = Field(default=False)
