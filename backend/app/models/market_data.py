"""
Market data — TAO/Alpha price, volume, liquidity, etc.
"""
from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class MarketData(Base):
    __tablename__ = "market_data"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    netuid: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    alpha_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    alpha_price_1h_change: Mapped[float | None] = mapped_column(Float, nullable=True)
    alpha_price_1d_change: Mapped[float | None] = mapped_column(Float, nullable=True)
    alpha_price_7d_change: Mapped[float | None] = mapped_column(Float, nullable=True)
    alpha_price_30d_change: Mapped[float | None] = mapped_column(Float, nullable=True)
    market_cap: Mapped[float | None] = mapped_column(Float, nullable=True)
    volume_24h: Mapped[float | None] = mapped_column(Float, nullable=True)
    volume_market_cap_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    liquidity: Mapped[float | None] = mapped_column(Float, nullable=True)
    liquidity_change: Mapped[float | None] = mapped_column(Float, nullable=True)
    buy_activity: Mapped[float | None] = mapped_column(Float, nullable=True)
    emission_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    emission_percentage: Mapped[float | None] = mapped_column(Float, nullable=True)
    incentive_burn: Mapped[float | None] = mapped_column(Float, nullable=True)
    tao_price_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    tao_price_inr: Mapped[float | None] = mapped_column(Float, nullable=True)
    data_source: Mapped[str] = mapped_column(Text, nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False, index=True)
