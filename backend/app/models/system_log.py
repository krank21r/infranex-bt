"""
System-wide log records.
"""
from sqlalchemy import String, Text, DateTime, JSON
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from typing import Optional
from datetime import datetime

from .base import Base


class SystemLog(Base):
    __tablename__ = "system_logs"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    level: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    source: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    details: Mapped[Optional[dict]] = mapped_column(JSONB, server_default="{}", nullable=True)
    job_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    worker: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False, index=True)
