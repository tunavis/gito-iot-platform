"""Authentication-related request and response schemas."""

from pydantic import BaseModel, EmailStr, Field
from typing import Optional


class LoginRequest(BaseModel):
    """User login request."""
    email: EmailStr = Field(description="User email address")
    password: str = Field(min_length=8, description="User password")


class TokenResponse(BaseModel):
    """JWT token response after successful login."""
    access_token: str = Field(description="JWT access token")
    refresh_token: Optional[str] = Field(None, description="Refresh token (optional)")
    token_type: str = "bearer"
    expires_in: int = Field(description="Token expiration in seconds")


class RefreshRequest(BaseModel):
    """Token refresh request."""
    refresh_token: str = Field(description="Refresh token")
