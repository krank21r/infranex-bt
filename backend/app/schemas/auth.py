"""
Authentication schemas.
"""
from typing import Optional, List
from pydantic import Field, EmailStr
from datetime import datetime

from app.schemas.common import BaseSchema, TimestampMixin, IDMixin


class Token(BaseSchema):
    """OAuth2 token response."""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = Field(description="Access token expiry in seconds")


class TokenData(BaseSchema):
    """Decoded token data."""
    sub: str = Field(description="Subject (user ID)")
    email: Optional[EmailStr] = None
    role: str = Field(default="authenticated")
    exp: Optional[int] = Field(default=None, description="Expiration timestamp")
    type: str = Field(default="access")


class TokenRefreshRequest(BaseSchema):
    """Token refresh request."""
    refresh_token: str


class User(BaseSchema, IDMixin, TimestampMixin):
    """User model."""
    email: EmailStr
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    is_active: bool = True
    is_verified: bool = False
    role: str = "user"
    metadata: dict = Field(default_factory=dict)


class UserProfile(BaseSchema):
    """User profile response."""
    id: str
    email: EmailStr
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    created_at: datetime
    is_verified: bool = False
    role: str = "user"


class UserUpdate(BaseSchema):
    """User update request."""
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    metadata: Optional[dict] = None


class AuthResponse(BaseSchema):
    """Authentication response."""
    user: UserProfile
    tokens: Token


class RefreshResponse(BaseSchema):
    """Token refresh response."""
    access_token: str
    token_type: str = "bearer"
    expires_in: int


# --- Supabase Auth Models ---

class SupabaseUser(BaseSchema):
    """Supabase user model."""
    id: str
    aud: str
    role: str
    email: EmailStr
    email_confirmed_at: Optional[str] = None
    phone: Optional[str] = None
    confirmed_at: Optional[str] = None
    last_sign_in_at: Optional[str] = None
    app_metadata: dict = Field(default_factory=dict)
    user_metadata: dict = Field(default_factory=dict)
    identities: List[dict] = Field(default_factory=list)
    created_at: str
    updated_at: str
    is_anonymous: bool = False


class SupabaseSession(BaseSchema):
    """Supabase session model."""
    access_token: str
    refresh_token: str
    expires_in: int
    token_type: str
    user: SupabaseUser