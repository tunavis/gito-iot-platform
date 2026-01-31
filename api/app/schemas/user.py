"""User management schemas for request/response validation."""

from pydantic import BaseModel, Field, EmailStr
from typing import Optional
from uuid import UUID
from datetime import datetime


class UserCreate(BaseModel):
    """Schema for creating a new user."""
    email: EmailStr = Field(..., description="User email address")
    password: str = Field(..., min_length=8, description="User password (min 8 chars)")
    full_name: str = Field(..., min_length=1, max_length=255, description="User full name")
    role: str = Field(
        default="VIEWER",
        pattern="^(SUPER_ADMIN|TENANT_ADMIN|SITE_ADMIN|CLIENT|VIEWER)$",
        description="User role"
    )
    status: str = Field(
        default="active",
        pattern="^(active|inactive|suspended)$",
        description="User status"
    )


class UserUpdate(BaseModel):
    """Schema for updating an existing user."""
    email: Optional[EmailStr] = Field(None, description="User email address")
    full_name: Optional[str] = Field(None, min_length=1, max_length=255, description="User full name")
    role: Optional[str] = Field(
        None,
        pattern="^(SUPER_ADMIN|TENANT_ADMIN|SITE_ADMIN|CLIENT|VIEWER)$",
        description="User role"
    )
    status: Optional[str] = Field(
        None,
        pattern="^(active|inactive|suspended)$",
        description="User status"
    )


class UserPasswordUpdate(BaseModel):
    """Schema for updating user password."""
    current_password: str = Field(..., description="Current password")
    new_password: str = Field(..., min_length=8, description="New password (min 8 chars)")


class UserResponse(BaseModel):
    """Schema for user response (excludes password_hash)."""
    id: UUID
    tenant_id: UUID
    email: str
    full_name: Optional[str]
    role: str
    status: str
    last_login_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class UserInviteRequest(BaseModel):
    """Schema for inviting a new user."""
    email: EmailStr = Field(..., description="User email address")
    full_name: str = Field(..., min_length=1, max_length=255, description="User full name")
    role: str = Field(
        default="VIEWER",
        pattern="^(SUPER_ADMIN|TENANT_ADMIN|SITE_ADMIN|CLIENT|VIEWER)$",
        description="User role"
    )


class UserInviteResponse(BaseModel):
    """Schema for user invitation response."""
    id: UUID
    email: str
    full_name: str
    role: str
    status: str
    invitation_sent: bool
    created_at: datetime

    class Config:
        from_attributes = True
