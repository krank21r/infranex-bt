"""
Neuron models — individual hotkey stake/incentive/ranks.
"""
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Neuron(Base):
    __tablename__ = "neurons"
    __table_args__ = (UniqueConstraint("netuid", "uid", "hotkey", name="uq_neurons_netuid_uid_hotkey"),)

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    uid: Mapped[int] = mapped_column(Integer, nullable=False)
    hotkey: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    coldkey: Mapped[str | None] = mapped_column(Text, nullable=True)
    stake: Mapped[float | None] = mapped_column(Float, nullable=True)
    rank: Mapped[float | None] = mapped_column(Float, nullable=True)
    trust: Mapped[float | None] = mapped_column(Float, nullable=True)
    consensus: Mapped[float | None] = mapped_column(Float, nullable=True)
    incentive: Mapped[float | None] = mapped_column(Float, nullable=True)
    emission: Mapped[float | None] = mapped_column(Float, nullable=True)
    dividends: Mapped[float | None] = mapped_column(Float, nullable=True)
    active: Mapped[bool | None] = mapped_column(Boolean, server_default="true", nullable=True)
    validator_permit: Mapped[bool | None] = mapped_column(Boolean, server_default="false", nullable=True)
    last_update: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    data_source: Mapped[str | None] = mapped_column(Text, server_default="bittensor_sdk", nullable=True)
    extra_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, server_default="{}", nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)


class NeuronMetricsHistory(Base):
    __tablename__ = "neuron_metrics_history"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    netuid: Mapped[int] = mapped_column(Integer, nullable=False)
    uid: Mapped[int] = mapped_column(Integer, nullable=False)
    hotkey: Mapped[str] = mapped_column(Text, nullable=False)
    stake: Mapped[float | None] = mapped_column(Float, nullable=True)
    rank: Mapped[float | None] = mapped_column(Float, nullable=True)
    trust: Mapped[float | None] = mapped_column(Float, nullable=True)
    consensus: Mapped[float | None] = mapped_column(Float, nullable=True)
    incentive: Mapped[float | None] = mapped_column(Float, nullable=True)
    emission: Mapped[float | None] = mapped_column(Float, nullable=True)
    dividends: Mapped[float | None] = mapped_column(Float, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)
