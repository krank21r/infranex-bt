"""
Neuron models — individual hotkey stake/incentive/ranks.
"""
from sqlalchemy import String, Integer, BigInteger, Float, Text, Boolean, DateTime, JSON, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from typing import Optional
from datetime import datetime

from .base import Base


class Neuron(Base):
    __tablename__ = "neurons"
    __table_args__ = (UniqueConstraint("netuid", "uid", "hotkey", name="uq_neurons_netuid_uid_hotkey"),)

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    uid: Mapped[int] = mapped_column(Integer, nullable=False)
    hotkey: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    coldkey: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    stake: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rank: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    trust: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    consensus: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    incentive: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    emission: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    dividends: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    active: Mapped[Optional[bool]] = mapped_column(Boolean, server_default="true", nullable=True)
    validator_permit: Mapped[Optional[bool]] = mapped_column(Boolean, server_default="false", nullable=True)
    last_update: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    data_source: Mapped[Optional[str]] = mapped_column(Text, server_default="bittensor_sdk", nullable=True)
    extra_metadata: Mapped[Optional[dict]] = mapped_column("metadata", JSONB, server_default="{}", nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)


class NeuronMetricsHistory(Base):
    __tablename__ = "neuron_metrics_history"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    netuid: Mapped[int] = mapped_column(Integer, nullable=False)
    uid: Mapped[int] = mapped_column(Integer, nullable=False)
    hotkey: Mapped[str] = mapped_column(Text, nullable=False)
    stake: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rank: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    trust: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    consensus: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    incentive: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    emission: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    dividends: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)
