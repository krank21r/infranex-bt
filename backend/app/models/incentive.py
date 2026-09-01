"""
Incentive records — per-neuron incentive snapshots.
"""
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Float, Integer, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Incentive(Base):
    __tablename__ = "incentives"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    uid: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hotkey: Mapped[str | None] = mapped_column(Text, nullable=True)
    incentive: Mapped[float | None] = mapped_column(Float, nullable=True)
    emission: Mapped[float | None] = mapped_column(Float, nullable=True)
    stake: Mapped[float | None] = mapped_column(Float, nullable=True)
    block: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    data_source: Mapped[str | None] = mapped_column(Text, server_default="bittensor_sdk", nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)
