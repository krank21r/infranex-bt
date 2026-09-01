"""
GPU models, providers, and dynamic offers.
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin


class GPUModel(Base, TimestampMixin):
    __tablename__ = "gpu_models"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    manufacturer: Mapped[str | None] = mapped_column(Text, server_default="NVIDIA", nullable=True)
    vram_gb: Mapped[float] = mapped_column(Float, nullable=False)
    cuda_cores: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cuda_compute_capability: Mapped[str | None] = mapped_column(Text, nullable=True)
    memory_bandwidth_gbps: Mapped[float | None] = mapped_column(Float, nullable=True)
    fp16_tflops: Mapped[float | None] = mapped_column(Float, nullable=True)
    fp32_tflops: Mapped[float | None] = mapped_column(Float, nullable=True)
    tdp_watts: Mapped[int | None] = mapped_column(Integer, nullable=True)
    generation: Mapped[str | None] = mapped_column(Text, nullable=True)
    tier: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool | None] = mapped_column(Boolean, server_default="true", nullable=True)
    extra_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, server_default="{}", nullable=True)


class GPUProvider(Base, TimestampMixin):
    __tablename__ = "gpu_providers"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    slug: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    api_base_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool | None] = mapped_column(Boolean, server_default="true", nullable=True)
    supports_mock: Mapped[bool | None] = mapped_column(Boolean, server_default="true", nullable=True)
    extra_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, server_default="{}", nullable=True)


class GPUOffer(Base):
    __tablename__ = "gpu_offers"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    provider_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, index=True)
    gpu_model_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, index=True)
    offer_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    region: Mapped[str | None] = mapped_column(Text, nullable=True)
    hourly_price: Mapped[float] = mapped_column(Float, nullable=False)
    monthly_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str | None] = mapped_column(Text, server_default="USD", nullable=True)
    availability: Mapped[str | None] = mapped_column(Text, server_default="available", nullable=True, index=True)
    instance_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    vram_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    ram_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    storage_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    cpu_cores: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bandwidth_gbps: Mapped[float | None] = mapped_column(Float, nullable=True)
    min_rental_hours: Mapped[int | None] = mapped_column(Integer, server_default="1", nullable=True)
    is_spot: Mapped[bool | None] = mapped_column(Boolean, server_default="false", nullable=True)
    extra_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, server_default="{}", nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)
