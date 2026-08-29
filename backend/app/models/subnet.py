"""
Subnet model — Bittensor subnet registry.
"""
from sqlalchemy import Integer, Boolean, BigInteger, Float, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from typing import Optional

from .base import Base, TimestampMixin


class Subnet(Base, TimestampMixin):
    __tablename__ = "subnets"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    netuid: Mapped[int] = mapped_column(Integer, unique=True, nullable=False, index=True)
    name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    subnet_type: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    owner_hotkey: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    max_neurons: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    max_allowed_validators: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    immunity_period: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    tempo: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    min_difficulty: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    max_difficulty: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    difficulty: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    rho: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    kappa: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    is_active: Mapped[Optional[bool]] = mapped_column(Boolean, server_default="true", nullable=True, index=True)
    registration_open: Mapped[Optional[bool]] = mapped_column(Boolean, server_default="true", nullable=True)
    extra_metadata: Mapped[Optional[dict]] = mapped_column("metadata", JSONB, server_default="{}", nullable=True)
