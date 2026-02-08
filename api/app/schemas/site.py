"""Pydantic schemas for site CRUD operations."""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from uuid import UUID


class SiteCreate(BaseModel):
    """Request schema for creating a site."""
    organization_id: UUID
    parent_site_id: Optional[UUID] = None
    name: str = Field(..., min_length=1, max_length=255)
    site_type: Optional[str] = Field(None, max_length=50)
    address: Optional[str] = None
    coordinates: Optional[dict] = None  # {"lat": 51.5074, "lng": -0.1278}
    timezone: str = Field(default="UTC", max_length=50)
    attributes: dict = Field(default_factory=dict)


class SiteUpdate(BaseModel):
    """Request schema for updating a site."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    site_type: Optional[str] = Field(None, max_length=50)
    address: Optional[str] = None
    coordinates: Optional[dict] = None
    timezone: Optional[str] = Field(None, max_length=50)
    attributes: Optional[dict] = None


class SiteResponse(BaseModel):
    """Response schema for a site."""
    id: UUID
    tenant_id: UUID
    organization_id: UUID
    parent_site_id: Optional[UUID] = None
    name: str
    site_type: Optional[str] = None
    address: Optional[str] = None
    coordinates: Optional[dict] = None
    timezone: str
    attributes: dict
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
