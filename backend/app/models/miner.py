"""
Miner + per-tick miner health.
"""
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Float, Integer, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin


class Miner(Base, TimestampMixin):
    __tablename__ = "miners"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    deployment_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    server_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    hotkey_address: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    coldkey_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    uid: Mapped[int | None] = mapped_column(Integer, nullable=True)
    process_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str | None] = mapped_column(Text, nullable=True)
    uptime_seconds: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    last_health_check: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    health_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    extra_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, server_default="{}", nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MinerHealth(Base):
    __tablename__ = "miner_health"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    miner_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, index=True)
    gpu_utilization: Mapped[float | None] = mapped_column(Float, nullable=True)
    gpu_temperature: Mapped[float | None] = mapped_column(Float, nullable=True)
    gpu_memory_utilization: Mapped[float | None] = mapped_column(Float, nullable=True)
    gpu_memory_used_mb: Mapped[float | None] = mapped_column(Float, nullable=True)
    gpu_power_draw: Mapped[float | None] = mapped_column(Float, nullable=True)
    cpu_usage: Mapped[float | None] = mapped_column(Float, nullable=True)
    ram_usage: Mapped[float | None] = mapped_column(Float, nullable=True)
    ram_used_mb: Mapped[float | None] = mapped_column(Float, nullable=True)
    disk_usage: Mapped[float | None] = mapped_column(Float, nullable=True)
    disk_used_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    network_rx_mbps: Mapped[float | None] = mapped_column(Float, nullable=True)
    network_tx_mbps: Mapped[float | None] = mapped_column(Float, nullable=True)
    miner_process_running: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    subnet_connected: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    incentive: Mapped[float | None] = mapped_column(Float, nullable=True)
    emission: Mapped[float | None] = mapped_column(Float, nullable=True)
    rank: Mapped[float | None] = mapped_column(Float, nullable=True)
    trust: Mapped[float | None] = mapped_column(Float, nullable=True)
    health_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    errors: Mapped[list | None] = mapped_column(ARRAY(Text), nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)
