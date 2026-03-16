"""Pydantic schemas for device commands (RPC Option B)."""

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class CommandCreate(BaseModel):
    """Request body for sending a command to a device."""
    command_name: str = Field(..., min_length=1, max_length=100, examples=["reboot", "set_interval"])
    parameters: dict[str, Any] = Field(default_factory=dict, examples=[{"interval": 30}])
    ttl_seconds: int = Field(default=60, ge=5, le=3600, description="Time-to-live in seconds before command times out")


class CommandResponse(BaseModel):
    """Single device command with lifecycle status."""
    id: UUID
    tenant_id: UUID
    device_id: UUID
    command_name: str
    parameters: dict[str, Any]
    status: str
    response: Optional[dict[str, Any]] = None
    error_message: Optional[str] = None
    created_at: datetime
    expires_at: datetime
    sent_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class CommandListResponse(BaseModel):
    """Paginated list of device commands."""
    data: list[CommandResponse]
    total: int
