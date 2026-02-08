"""Pydantic schemas for organization CRUD operations."""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from uuid import UUID


class OrganizationCreate(BaseModel):
    """Request schema for creating an organization."""
    name: str = Field(..., min_length=1, max_length=255)
    slug: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    billing_contact: Optional[str] = None
    chirpstack_app_id: Optional[str] = None
    attributes: dict = Field(default_factory=dict)


class OrganizationUpdate(BaseModel):
    """Request schema for updating an organization."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    billing_contact: Optional[str] = None
    chirpstack_app_id: Optional[str] = None
    status: Optional[str] = Field(None, pattern="^(active|inactive|suspended)$")
    attributes: Optional[dict] = None


class OrganizationResponse(BaseModel):
    """Response schema for an organization."""
    id: UUID
    tenant_id: UUID
    name: str
    slug: str
    description: Optional[str] = None
    billing_contact: Optional[str] = None
    chirpstack_app_id: Optional[str] = None
    status: str
    attributes: dict
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
