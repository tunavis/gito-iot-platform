"""Audit log schemas for request/response validation."""

from pydantic import BaseModel, Field
from typing import Optional
from uuid import UUID
from datetime import datetime


class AuditLogResponse(BaseModel):
    """Schema for audit log response."""
    id: UUID
    tenant_id: UUID
    user_id: Optional[UUID]
    action: str
    resource_type: Optional[str]
    resource_id: Optional[UUID]
    changes: Optional[dict]
    ip_address: Optional[str]
    user_agent: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class AuditLogCreate(BaseModel):
    """Schema for creating audit log entries (internal use)."""
    tenant_id: UUID
    user_id: Optional[UUID] = None
    action: str = Field(..., max_length=100)
    resource_type: Optional[str] = Field(None, max_length=100)
    resource_id: Optional[UUID] = None
    changes: Optional[dict] = None
    ip_address: Optional[str] = Field(None, max_length=45)
    user_agent: Optional[str] = None
