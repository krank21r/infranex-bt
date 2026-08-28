"""
Deployment + GPU server records.
"""
from sqlalchemy import String, Integer, Float, Text, Boolean, DateTime, JSON
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from typing import Optional
from datetime import datetime

from .base import Base, TimestampMixin


class Deployment(Base, TimestampMixin):
    __tablename__ = "deployments"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    user_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    subnet_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    gpu_model_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    gpu_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    provider_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    provider_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    opportunity_score_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    compatibility_test_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    status: Mapped[str] = mapped_column(Text, server_default="requested", nullable=False, index=True)
    server_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    hotkey_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    deployment_config: Mapped[Optional[dict]] = mapped_column(JSONB, server_default="{}", nullable=True)
    estimated_monthly_cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    estimated_monthly_revenue: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    currency: Mapped[Optional[str]] = mapped_column(Text, server_default="INR", nullable=True)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    provisioned_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    stopped_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    terminated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    extra_metadata: Mapped[Optional[dict]] = mapped_column("metadata", JSONB, server_default="{}", nullable=True)


class Server(Base, TimestampMixin):
    __tablename__ = "servers"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    deployment_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    provider_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    provider_instance_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    region: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ssh_port: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    gpu_model: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    gpu_count: Mapped[Optional[int]] = mapped_column(Integer, server_default="1", nullable=True)
    vram_gb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ram_gb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cpu_cores: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    storage_gb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    hourly_cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    currency: Mapped[Optional[str]] = mapped_column(Text, server_default="USD", nullable=True)
    extra_metadata: Mapped[Optional[dict]] = mapped_column("metadata", JSONB, server_default="{}", nullable=True)
    provisioned_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    terminated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
