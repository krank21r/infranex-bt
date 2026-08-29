"""
Subnet metrics (current snapshot + time-series).
"""
from sqlalchemy import Integer, BigInteger, Float, Text, DateTime
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from typing import Optional
from datetime import datetime

from .base import Base


class SubnetMetrics(Base):
    __tablename__ = "subnet_metrics"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    block: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    miner_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    validator_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    emission: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    total_emission: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    average_incentive: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    median_incentive: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    top_incentive: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    total_incentive: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    total_stake: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    average_stake: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    trust: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    consensus: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rank: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    registration_cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    neuron_utilization: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    top_5_concentration: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    top_10_concentration: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    miner_turnover: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    data_source: Mapped[Optional[str]] = mapped_column(Text, server_default="bittensor_sdk", nullable=True)
    extra_metadata: Mapped[Optional[dict]] = mapped_column("metadata", JSONB, server_default="{}", nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False, index=True)


class SubnetMetricsHistory(Base):
    __tablename__ = "subnet_metrics_history"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    netuid: Mapped[int] = mapped_column(Integer, nullable=False)
    block: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    miner_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    validator_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    emission: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    total_emission: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    average_incentive: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    median_incentive: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    top_incentive: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    total_incentive: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    total_stake: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    average_stake: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    trust: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    consensus: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rank: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    registration_cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    neuron_utilization: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    data_source: Mapped[Optional[str]] = mapped_column(Text, server_default="bittensor_sdk", nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False, index=True)
