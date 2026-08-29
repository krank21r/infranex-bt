"""
Monitoring data contracts.

Pure Pydantic models used by the aggregator, alert engine, and API layer.
No DB dependency here — these are the in-flight representations.
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field, ConfigDict


class AlertSeverity(str, Enum):
    critical = "critical"
    warning = "warning"
    info = "info"


class AlertType(str, Enum):
    miner_down = "miner_down"
    low_gpu_utilization = "low_gpu_utilization"
    high_temperature = "high_temperature"
    subnet_disconnected = "subnet_disconnected"
    negative_roi = "negative_roi"


class Alert(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    alert_type: AlertType
    severity: AlertSeverity
    message: str
    miner_id: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    resolved_at: Optional[datetime] = None
    is_resolved: bool = False


class MinerHealthSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    miner_id: str
    status: str
    netuid: int
    hotkey_address: str
    health_score: Optional[float] = None
    uptime_seconds: Optional[int] = None
    last_health_check: Optional[datetime] = None

    latest_gpu: dict[str, Any] = Field(default_factory=dict)
    gpu_utilization_avg: Optional[float] = None
    gpu_temperature_avg: Optional[float] = None

    emission: Optional[float] = None
    incentive: Optional[float] = None
    rank: Optional[float] = None
    trust: Optional[float] = None

    active_alerts: int = 0
    recent_errors: list[str] = Field(default_factory=list)


class SubnetPerformance(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    netuid: int
    miner_count: int
    active_miners: int
    down_miners: int
    avg_health_score: Optional[float] = None
    avg_gpu_utilization: Optional[float] = None
    avg_gpu_temperature: Optional[float] = None
    total_emission: Optional[float] = None
    total_incentive: Optional[float] = None
    active_alerts: int = 0
    miners: list[MinerHealthSummary] = Field(default_factory=list)


class SystemOverview(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    total_miners: int
    active_miners: int
    inactive_miners: int
    down_miners: int
    total_subnets: int
    active_subnets: int
    total_alerts: int
    critical_alerts: int
    warning_alerts: int
    info_alerts: int
    avg_system_health_score: Optional[float] = None
    total_emission_24h: Optional[float] = None
    total_incentive_24h: Optional[float] = None
    alerts: list[Alert] = Field(default_factory=list)
