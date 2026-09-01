"""
Deployment + GPU server records.
"""
from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin


class Deployment(Base, TimestampMixin):
    __tablename__ = "deployments"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    user_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    subnet_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    gpu_model_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    gpu_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    provider_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    provider_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    opportunity_score_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    compatibility_test_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    status: Mapped[str] = mapped_column(Text, server_default="requested", nullable=False, index=True)
    server_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    hotkey_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    deployment_config: Mapped[dict | None] = mapped_column(JSONB, server_default="{}", nullable=True)
    estimated_monthly_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    estimated_monthly_revenue: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str | None] = mapped_column(Text, server_default="INR", nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    provisioned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    terminated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    extra_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, server_default="{}", nullable=True)


class Server(Base, TimestampMixin):
    __tablename__ = "servers"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    deployment_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    provider_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    provider_instance_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    name: Mapped[str | None] = mapped_column(Text, nullable=True)
    region: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    ssh_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gpu_model: Mapped[str | None] = mapped_column(Text, nullable=True)
    gpu_count: Mapped[int | None] = mapped_column(Integer, server_default="1", nullable=True)
    vram_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    ram_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    cpu_cores: Mapped[int | None] = mapped_column(Integer, nullable=True)
    storage_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    hourly_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str | None] = mapped_column(Text, server_default="USD", nullable=True)
    extra_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, server_default="{}", nullable=True)
    provisioned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    terminated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
