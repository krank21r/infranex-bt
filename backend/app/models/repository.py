"""
Repository + extracted subnet requirements.
"""
from sqlalchemy import Integer, Float, Text, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY
from sqlalchemy.orm import Mapped, mapped_column
from typing import Optional
from datetime import datetime

from .base import Base, TimestampMixin


class Repository(Base, TimestampMixin):
    __tablename__ = "repositories"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    branch: Mapped[Optional[str]] = mapped_column(Text, server_default="main", nullable=True)
    last_analyzed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    analysis_status: Mapped[Optional[str]] = mapped_column(Text, server_default="pending", nullable=True)
    readme_content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    extra_metadata: Mapped[Optional[dict]] = mapped_column("metadata", JSONB, server_default="{}", nullable=True)


class SubnetRequirement(Base, TimestampMixin):
    __tablename__ = "subnet_requirements"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    repository_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    python_version: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cuda_version: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    pytorch_version: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    min_vram_gb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    recommended_gpu: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ram_gb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cpu_cores: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    storage_gb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    docker_required: Mapped[Optional[bool]] = mapped_column(Boolean, server_default="false", nullable=True)
    nvidia_runtime_required: Mapped[Optional[bool]] = mapped_column(Boolean, server_default="false", nullable=True)
    ports: Mapped[Optional[list]] = mapped_column(ARRAY(Integer), nullable=True)
    env_variables: Mapped[Optional[dict]] = mapped_column(JSONB, server_default="{}", nullable=True)
    startup_command: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    miner_command: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    dependencies: Mapped[Optional[dict]] = mapped_column(JSONB, server_default="{}", nullable=True)
    raw_requirements: Mapped[Optional[dict]] = mapped_column(JSONB, server_default="{}", nullable=True)
    extraction_confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
