"""
Reward, expense, and profitability records.
"""
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Float, Integer, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Reward(Base):
    __tablename__ = "rewards"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    miner_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, index=True)
    deployment_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    hotkey_address: Mapped[str] = mapped_column(Text, nullable=False)
    alpha_amount: Mapped[float] = mapped_column(Float, nullable=False)
    tao_equivalent: Mapped[float | None] = mapped_column(Float, nullable=True)
    emission: Mapped[float | None] = mapped_column(Float, nullable=True)
    incentive: Mapped[float | None] = mapped_column(Float, nullable=True)
    block: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    reward_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    currency: Mapped[str | None] = mapped_column(Text, server_default="TAO", nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)


class Expense(Base):
    __tablename__ = "expenses"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    deployment_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    server_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    expense_type: Mapped[str] = mapped_column(Text, nullable=False)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str | None] = mapped_column(Text, server_default="USD", nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)


class Profitability(Base):
    __tablename__ = "profitability"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    deployment_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    miner_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    netuid: Mapped[int] = mapped_column(Integer, nullable=False)
    period: Mapped[str] = mapped_column(Text, nullable=False)
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    total_revenue: Mapped[float | None] = mapped_column(Float, server_default="0", nullable=True)
    total_expenses: Mapped[float | None] = mapped_column(Float, server_default="0", nullable=True)
    gross_profit: Mapped[float | None] = mapped_column(Float, server_default="0", nullable=True)
    net_profit: Mapped[float | None] = mapped_column(Float, server_default="0", nullable=True)
    roi: Mapped[float | None] = mapped_column(Float, nullable=True)
    alpha_earned: Mapped[float | None] = mapped_column(Float, server_default="0", nullable=True)
    tao_equivalent: Mapped[float | None] = mapped_column(Float, server_default="0", nullable=True)
    gpu_cost: Mapped[float | None] = mapped_column(Float, server_default="0", nullable=True)
    storage_cost: Mapped[float | None] = mapped_column(Float, server_default="0", nullable=True)
    bandwidth_cost: Mapped[float | None] = mapped_column(Float, server_default="0", nullable=True)
    other_cost: Mapped[float | None] = mapped_column(Float, server_default="0", nullable=True)
    currency: Mapped[str | None] = mapped_column(Text, server_default="INR", nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)
