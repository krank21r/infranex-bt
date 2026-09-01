"""
Emission records — block-level subnet emissions.
"""
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Float, Integer, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Emission(Base):
    __tablename__ = "emissions"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    block: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    emission_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    subnet_emission: Mapped[float | None] = mapped_column(Float, nullable=True)
    owner_emission: Mapped[float | None] = mapped_column(Float, nullable=True)
    miner_emission: Mapped[float | None] = mapped_column(Float, nullable=True)
    validator_emission: Mapped[float | None] = mapped_column(Float, nullable=True)
    data_source: Mapped[str | None] = mapped_column(Text, server_default="bittensor_sdk", nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)
