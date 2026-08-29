"""
User model — links Supabase auth user to operator profile.
"""
from sqlalchemy import Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from typing import Optional

from .base import Base, TimestampMixin


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    auth_id: Mapped[str] = mapped_column(UUID(as_uuid=False), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    display_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    wallet_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    hotkey_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    role: Mapped[str] = mapped_column(Text, nullable=False, server_default="operator")
    settings: Mapped[Optional[dict]] = mapped_column(JSONB, server_default="{}", nullable=True)
