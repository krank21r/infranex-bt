"""
Authentication API routes.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_user
from app.core.auth import refresh_access_token, AuthError
from app.core.config import settings
from app.schemas.auth import (
    UserProfile,
    TokenRefreshRequest,
    RefreshResponse,
)
from app.schemas.common import APIResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me", response_model=APIResponse[UserProfile])
async def get_current_user_profile(
    current_user = Depends(get_current_user),
) -> APIResponse[UserProfile]:
    """
    Get current authenticated user's profile.
    """
    return APIResponse(success=True, data=current_user)


@router.post("/refresh", response_model=APIResponse[RefreshResponse])
async def refresh_token(
    request: TokenRefreshRequest,
) -> APIResponse[RefreshResponse]:
    """
    Refresh access token using refresh token.
    """
    try:
        tokens = await refresh_access_token(request.refresh_token)
        return APIResponse(
            success=True,
            data=RefreshResponse(
                access_token=tokens["access_token"],
                token_type=tokens["token_type"],
                expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            ),
        )
    except AuthError as e:
        raise HTTPException(
            status_code=e.status_code,
            detail=e.message,
        )


@router.post("/logout", response_model=APIResponse[dict])
async def logout(
    current_user = Depends(get_current_user),
) -> APIResponse[dict]:
    """
    Logout current user (client-side token removal).
    Server-side token blacklisting would require Redis.
    """
    return APIResponse(
        success=True,
        data={"message": "Logged out successfully"},
        message="Please remove tokens from client storage",
    )


@router.get("/verify", response_model=APIResponse[dict])
async def verify_token(
    current_user = Depends(get_current_user),
) -> APIResponse[dict]:
    """
    Verify if the current token is valid.
    """
    return APIResponse(
        success=True,
        data={"valid": True, "user_id": current_user.id},
    )
