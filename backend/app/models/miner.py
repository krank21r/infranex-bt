"""
Miner + per-tick miner health.
"""
from sqlalchemy import String, Integer, BigInteger, Float, Text, Boolean, DateTime, JSON
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY
from sqlalchemy.orm import Mapped, mapped_column
from typing import Optional
from datetime import datetime

from .base import Base, TimestampMixin


class Miner(Base, TimestampMixin):
    __tablename__ = "miners"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    deployment_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    server_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    hotkey_address: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    coldkey_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    uid: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    process_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    status: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    uptime_seconds: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    last_health_check: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    health_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    extra_metadata: Mapped[Optional[dict]] = mapped_column("metadata", JSONB, server_default="{}", nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    stopped_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class MinerHealth(Base):
    __tablename__ = "miner_health"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    miner_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, index=True)
    gpu_utilization: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    gpu_temperature: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    gpu_memory_utilization: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    gpu_memory_used_mb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    gpu_power_draw: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cpu_usage: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ram_usage: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ram_used_mb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    disk_usage: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    disk_used_gb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    network_rx_mbps: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    network_tx_mbps: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    miner_process_running: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    subnet_connected: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    incentive: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    emission: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rank: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    trust: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    health_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    errors: Mapped[Optional[list]] = mapped_column(ARRAY(Text), nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)
