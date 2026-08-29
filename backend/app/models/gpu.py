"""
GPU models, providers, and dynamic offers.
"""
from sqlalchemy import Integer, Float, Text, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from typing import Optional
from datetime import datetime

from .base import Base, TimestampMixin


class GPUModel(Base, TimestampMixin):
    __tablename__ = "gpu_models"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    manufacturer: Mapped[Optional[str]] = mapped_column(Text, server_default="NVIDIA", nullable=True)
    vram_gb: Mapped[float] = mapped_column(Float, nullable=False)
    cuda_cores: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    cuda_compute_capability: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    memory_bandwidth_gbps: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    fp16_tflops: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    fp32_tflops: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    tdp_watts: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    generation: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tier: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[Optional[bool]] = mapped_column(Boolean, server_default="true", nullable=True)
    extra_metadata: Mapped[Optional[dict]] = mapped_column("metadata", JSONB, server_default="{}", nullable=True)


class GPUProvider(Base, TimestampMixin):
    __tablename__ = "gpu_providers"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    slug: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    api_base_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[Optional[bool]] = mapped_column(Boolean, server_default="true", nullable=True)
    supports_mock: Mapped[Optional[bool]] = mapped_column(Boolean, server_default="true", nullable=True)
    extra_metadata: Mapped[Optional[dict]] = mapped_column("metadata", JSONB, server_default="{}", nullable=True)


class GPUOffer(Base):
    __tablename__ = "gpu_offers"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    provider_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, index=True)
    gpu_model_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, index=True)
    offer_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    region: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    hourly_price: Mapped[float] = mapped_column(Float, nullable=False)
    monthly_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    currency: Mapped[Optional[str]] = mapped_column(Text, server_default="USD", nullable=True)
    availability: Mapped[Optional[str]] = mapped_column(Text, server_default="available", nullable=True, index=True)
    instance_type: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    vram_gb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ram_gb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    storage_gb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cpu_cores: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    bandwidth_gbps: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    min_rental_hours: Mapped[Optional[int]] = mapped_column(Integer, server_default="1", nullable=True)
    is_spot: Mapped[Optional[bool]] = mapped_column(Boolean, server_default="false", nullable=True)
    extra_metadata: Mapped[Optional[dict]] = mapped_column("metadata", JSONB, server_default="{}", nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)
