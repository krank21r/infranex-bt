"""
Subnet model — Bittensor subnet registry.
"""

from sqlalchemy import BigInteger, Boolean, Float, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin


class Subnet(Base, TimestampMixin):
    __tablename__ = "subnets"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    netuid: Mapped[int] = mapped_column(Integer, unique=True, nullable=False, index=True)
    name: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    subnet_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_hotkey: Mapped[str | None] = mapped_column(Text, nullable=True)
    max_neurons: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_allowed_validators: Mapped[int | None] = mapped_column(Integer, nullable=True)
    immunity_period: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tempo: Mapped[int | None] = mapped_column(Integer, nullable=True)
    min_difficulty: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    max_difficulty: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    difficulty: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    rho: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kappa: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_active: Mapped[bool | None] = mapped_column(Boolean, server_default="true", nullable=True, index=True)
    registration_open: Mapped[bool | None] = mapped_column(Boolean, server_default="true", nullable=True)
    extra_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, server_default="{}", nullable=True)
