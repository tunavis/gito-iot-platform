"""Pydantic schemas for device credential (token) management."""

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


class DeviceTokenCreate(BaseModel):
    name: str = Field(default="Default", max_length=100, description="Display label for this token")
    expires_days: Optional[int] = Field(default=None, ge=1, description="Token lifetime in days. Omit for no expiry.")


class DeviceTokenOut(BaseModel):
    """Returned when listing tokens — never exposes the hash or plain token."""
    id: UUID
    name: str
    status: str
    created_at: datetime
    expires_at: Optional[datetime]

    class Config:
        from_attributes = True


class DeviceTokenCreated(DeviceTokenOut):
    """Returned only on token creation — includes the plain token (shown once)."""
    token: str = Field(description="Plain token — save this now, it will not be shown again.")
