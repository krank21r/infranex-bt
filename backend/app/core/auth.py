"""
Authentication module for JWT validation and Supabase auth integration.
"""
import jwt
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jwt.exceptions import InvalidTokenError, ExpiredSignatureError
from pydantic import BaseModel

from app.core.config import settings
from app.core.database import get_supabase_admin
from app.schemas.auth import TokenData, User


# Security scheme
security = HTTPBearer(auto_error=False)


class AuthError(Exception):
    """Custom authentication error."""
    def __init__(self, message: str, status_code: int = status.HTTP_401_UNAUTHORIZED):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "type": "access"})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def create_refresh_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT refresh token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def decode_token(token: str) -> Dict[str, Any]:
    """Decode and validate a JWT token."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except ExpiredSignatureError:
        raise AuthError("Token has expired", status.HTTP_401_UNAUTHORIZED)
    except InvalidTokenError as e:
        raise AuthError(f"Invalid token: {str(e)}", status.HTTP_401_UNAUTHORIZED)


def verify_supabase_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Verify a Supabase JWT token using the JWT secret.
    Supabase tokens are JWTs signed with the project's JWT secret.
    """
    try:
        # Supabase uses HS256 with the JWT secret
        payload = jwt.decode(
            token,
            settings.SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
            options={"verify_aud": True}
        )
        return payload
    except ExpiredSignatureError:
        raise AuthError("Supabase token has expired", status.HTTP_401_UNAUTHORIZED)
    except InvalidTokenError as e:
        raise AuthError(f"Invalid Supabase token: {str(e)}", status.HTTP_401_UNAUTHORIZED)


async def get_current_user_from_supabase(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> User:
    """
    Get current user from Supabase JWT token.
    Validates the token and fetches user info from Supabase.
    """
    if not credentials:
        raise AuthError("Not authenticated", status.HTTP_401_UNAUTHORIZED)
    
    token = credentials.credentials
    
    # Verify the Supabase token
    try:
        payload = verify_supabase_token(token)
    except AuthError:
        raise
    
    # Extract user ID from token
    user_id = payload.get("sub")
    if not user_id:
        raise AuthError("Invalid token: missing user ID", status.HTTP_401_UNAUTHORIZED)
    
    # Fetch user from Supabase
    try:
        supabase = await get_supabase_admin()
        user_response = supabase.auth.admin.get_user_by_id(user_id)
        if not user_response.user:
            raise AuthError("User not found", status.HTTP_404_NOT_FOUND)
        
        user_data = user_response.user
        return User(
            id=user_data.id,
            email=user_data.email,
            full_name=user_data.user_metadata.get("full_name"),
            avatar_url=user_data.user_metadata.get("avatar_url"),
            created_at=user_data.created_at,
            updated_at=user_data.updated_at,
            is_active=True,
        )
    except Exception as e:
        raise AuthError(f"Failed to fetch user: {str(e)}", status.HTTP_500_INTERNAL_SERVER_ERROR)


async def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> Optional[User]:
    """
    Get current user if authenticated, otherwise return None.
    Useful for endpoints that work both with and without auth.
    """
    if not credentials:
        return None
    
    try:
        return await get_current_user_from_supabase(credentials)
    except AuthError:
        return None


def get_token_data(credentials: HTTPAuthorizationCredentials = Depends(security)) -> TokenData:
    """
    Extract token data from JWT without full user validation.
    Used for lightweight auth checks.
    """
    if not credentials:
        raise AuthError("Not authenticated", status.HTTP_401_UNAUTHORIZED)
    
    token = credentials.credentials
    
    try:
        payload = verify_supabase_token(token)
        return TokenData(
            sub=payload.get("sub"),
            email=payload.get("email"),
            role=payload.get("role", "authenticated"),
            exp=payload.get("exp"),
        )
    except AuthError:
        raise
    except Exception as e:
        raise AuthError(f"Invalid token: {str(e)}", status.HTTP_401_UNAUTHORIZED)


# --- Permission Helpers ---

def require_role(required_role: str):
    """Dependency factory for role-based access control."""
    async def role_checker(token_data: TokenData = Depends(get_token_data)) -> TokenData:
        if token_data.role != required_role and token_data.role != "admin":
            raise AuthError(
                f"Insufficient permissions: requires {required_role} role",
                status.HTTP_403_FORBIDDEN
            )
        return token_data
    return role_checker


def require_admin(token_data: TokenData = Depends(get_token_data)) -> TokenData:
    """Dependency for admin-only endpoints."""
    if token_data.role != "admin":
        raise AuthError("Admin access required", status.HTTP_403_FORBIDDEN)
    return token_data


# --- Token Refresh ---

async def refresh_access_token(refresh_token: str) -> Dict[str, str]:
    """Refresh an access token using a valid refresh token."""
    try:
        payload = decode_token(refresh_token)
        if payload.get("type") != "refresh":
            raise AuthError("Invalid token type", status.HTTP_401_UNAUTHORIZED)
        
        user_id = payload.get("sub")
        if not user_id:
            raise AuthError("Invalid token: missing user ID", status.HTTP_401_UNAUTHORIZED)
        
        # Verify user still exists in Supabase
        supabase = await get_supabase_admin()
        user_response = supabase.auth.admin.get_user_by_id(user_id)
        if not user_response.user:
            raise AuthError("User not found", status.HTTP_404_NOT_FOUND)
        
        # Create new tokens
        new_access_token = create_access_token({"sub": user_id})
        new_refresh_token = create_refresh_token({"sub": user_id})
        
        return {
            "access_token": new_access_token,
            "refresh_token": new_refresh_token,
            "token_type": "bearer",
        }
    except AuthError:
        raise
    except Exception as e:
        raise AuthError(f"Token refresh failed: {str(e)}", status.HTTP_500_INTERNAL_SERVER_ERROR)