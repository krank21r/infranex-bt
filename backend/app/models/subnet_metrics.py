"""
Subnet metrics (current snapshot + time-series).
"""
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Float, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class SubnetMetrics(Base):
    __tablename__ = "subnet_metrics"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    block: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    miner_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    validator_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    emission: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_emission: Mapped[float | None] = mapped_column(Float, nullable=True)
    average_incentive: Mapped[float | None] = mapped_column(Float, nullable=True)
    median_incentive: Mapped[float | None] = mapped_column(Float, nullable=True)
    top_incentive: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_incentive: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_stake: Mapped[float | None] = mapped_column(Float, nullable=True)
    average_stake: Mapped[float | None] = mapped_column(Float, nullable=True)
    trust: Mapped[float | None] = mapped_column(Float, nullable=True)
    consensus: Mapped[float | None] = mapped_column(Float, nullable=True)
    rank: Mapped[float | None] = mapped_column(Float, nullable=True)
    registration_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    neuron_utilization: Mapped[float | None] = mapped_column(Float, nullable=True)
    top_5_concentration: Mapped[float | None] = mapped_column(Float, nullable=True)
    top_10_concentration: Mapped[float | None] = mapped_column(Float, nullable=True)
    miner_turnover: Mapped[float | None] = mapped_column(Float, nullable=True)
    data_source: Mapped[str | None] = mapped_column(Text, server_default="bittensor_sdk", nullable=True)
    extra_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, server_default="{}", nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False, index=True)


class SubnetMetricsHistory(Base):
    __tablename__ = "subnet_metrics_history"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    netuid: Mapped[int] = mapped_column(Integer, nullable=False)
    block: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    miner_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    validator_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    emission: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_emission: Mapped[float | None] = mapped_column(Float, nullable=True)
    average_incentive: Mapped[float | None] = mapped_column(Float, nullable=True)
    median_incentive: Mapped[float | None] = mapped_column(Float, nullable=True)
    top_incentive: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_incentive: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_stake: Mapped[float | None] = mapped_column(Float, nullable=True)
    average_stake: Mapped[float | None] = mapped_column(Float, nullable=True)
    trust: Mapped[float | None] = mapped_column(Float, nullable=True)
    consensus: Mapped[float | None] = mapped_column(Float, nullable=True)
    rank: Mapped[float | None] = mapped_column(Float, nullable=True)
    registration_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    neuron_utilization: Mapped[float | None] = mapped_column(Float, nullable=True)
    data_source: Mapped[str | None] = mapped_column(Text, server_default="bittensor_sdk", nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False, index=True)
