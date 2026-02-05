"""Authentication routes for user login and token management."""

from fastapi import APIRouter, Depends, HTTPException, status, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Annotated

from app.database import get_session
from app.models.base import User
from app.schemas.auth import LoginRequest, TokenResponse, RefreshRequest
from app.schemas.common import SuccessResponse, ErrorDetail, ErrorResponse
from app.security import verify_password, create_access_token, decode_token
from app.config import get_settings

router = APIRouter(prefix="/auth", tags=["authentication"])


@router.post("/login", response_model=SuccessResponse[TokenResponse])
async def login(
    request: LoginRequest,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """User login endpoint - returns JWT access token and sets httpOnly cookie.

    Args:
        email: User email
        password: User password

    Returns:
        JWT access token with tenant_id and role in claims
        Also sets auth_token cookie for Next.js middleware
    """
    # Query user by email (case-insensitive)
    query = select(User).where(User.email == request.email.lower())
    result = await session.execute(query)
    user = result.scalar_one_or_none()

    if not user or not verify_password(request.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )

    # Create JWT token
    settings = get_settings()
    access_token = create_access_token(
        tenant_id=user.tenant_id,
        user_id=user.id,
        user_role=user.role,
    )

    # Set httpOnly cookie for Next.js middleware
    response.set_cookie(
        key="auth_token",
        value=access_token,
        httponly=True,  # Prevents JavaScript access (XSS protection)
        secure=settings.APP_ENV == "production",  # HTTPS only in production
        samesite="lax",  # CSRF protection
        max_age=settings.JWT_EXPIRATION_HOURS * 3600,  # Cookie expiration
        path="/",  # Available across entire site
    )

    # Update last_login (fire and forget - don't wait for result)
    # In production, consider doing this async

    return SuccessResponse(
        data=TokenResponse(
            access_token=access_token,
            expires_in=settings.JWT_EXPIRATION_HOURS * 3600,
        )
    )


@router.post("/refresh", response_model=SuccessResponse[TokenResponse])
async def refresh_token(
    request: RefreshRequest,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Refresh access token using refresh token.

    Args:
        refresh_token: Previously issued refresh token

    Returns:
        New access token and updates cookie
    """
    # Decode the refresh token
    try:
        payload = decode_token(request.refresh_token)
    except HTTPException:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    # Query user to verify still exists and active
    user_id = payload.get("sub")
    tenant_id = payload.get("tenant_id")

    query = select(User).where(User.id == user_id)
    result = await session.execute(query)
    user = result.scalar_one_or_none()

    if not user or user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    # Create new token
    settings = get_settings()
    access_token = create_access_token(
        tenant_id=tenant_id,
        user_id=user_id,
        user_role=user.role,
    )

    # Update cookie
    response.set_cookie(
        key="auth_token",
        value=access_token,
        httponly=True,
        secure=settings.APP_ENV == "production",
        samesite="lax",
        max_age=settings.JWT_EXPIRATION_HOURS * 3600,
        path="/",
    )

    return SuccessResponse(
        data=TokenResponse(
            access_token=access_token,
            expires_in=settings.JWT_EXPIRATION_HOURS * 3600,
        )
    )


@router.post("/logout")
async def logout(response: Response):
    """Logout endpoint - clears auth cookie.

    JWT tokens are stateless, but we clear the httpOnly cookie.
    Client should also delete JWT from localStorage.
    """
    # Clear the auth_token cookie
    response.delete_cookie(key="auth_token", path="/")

    return SuccessResponse(data={"message": "Logged out successfully"})
