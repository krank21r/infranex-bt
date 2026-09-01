"""
Repository + extracted subnet requirements.
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin


class Repository(Base, TimestampMixin):
    __tablename__ = "repositories"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    branch: Mapped[str | None] = mapped_column(Text, server_default="main", nullable=True)
    last_analyzed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    analysis_status: Mapped[str | None] = mapped_column(Text, server_default="pending", nullable=True)
    readme_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    extra_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, server_default="{}", nullable=True)


class SubnetRequirement(Base, TimestampMixin):
    __tablename__ = "subnet_requirements"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    repository_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    python_version: Mapped[str | None] = mapped_column(Text, nullable=True)
    cuda_version: Mapped[str | None] = mapped_column(Text, nullable=True)
    pytorch_version: Mapped[str | None] = mapped_column(Text, nullable=True)
    min_vram_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    recommended_gpu: Mapped[str | None] = mapped_column(Text, nullable=True)
    ram_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    cpu_cores: Mapped[int | None] = mapped_column(Integer, nullable=True)
    storage_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    docker_required: Mapped[bool | None] = mapped_column(Boolean, server_default="false", nullable=True)
    nvidia_runtime_required: Mapped[bool | None] = mapped_column(Boolean, server_default="false", nullable=True)
    ports: Mapped[list | None] = mapped_column(ARRAY(Integer), nullable=True)
    env_variables: Mapped[dict | None] = mapped_column(JSONB, server_default="{}", nullable=True)
    startup_command: Mapped[str | None] = mapped_column(Text, nullable=True)
    miner_command: Mapped[str | None] = mapped_column(Text, nullable=True)
    dependencies: Mapped[dict | None] = mapped_column(JSONB, server_default="{}", nullable=True)
    raw_requirements: Mapped[dict | None] = mapped_column(JSONB, server_default="{}", nullable=True)
    extraction_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
