"""Pydantic schemas for asset CRUD operations."""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from uuid import UUID


class AssetCreate(BaseModel):
    """Request schema for creating an asset."""

    # No default: omitting site_id fails at the Pydantic layer with 422 before any
    # handler code runs. An asset always stands somewhere.
    site_id: UUID
    parent_id: Optional[UUID] = None
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    # Free text by design — no enum, no lookup table. See models/asset.py.
    asset_type: Optional[str] = Field(None, max_length=100)
    attributes: dict = Field(default_factory=dict)


class AssetUpdate(BaseModel):
    """Request schema for updating an asset.

    `parent_id` is intentionally absent from the "unset means unchanged" shortcut
    routers usually take: clearing a parent (making an asset a root) and leaving it
    alone are different intents, and the router distinguishes them with
    `model_fields_set`.
    """

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    asset_type: Optional[str] = Field(None, max_length=100)
    parent_id: Optional[UUID] = None
    site_id: Optional[UUID] = None
    attributes: Optional[dict] = None


class AssetResponse(BaseModel):
    """Response schema for an asset."""

    id: UUID
    tenant_id: UUID
    site_id: UUID
    parent_id: Optional[UUID] = None
    name: str
    description: Optional[str] = None
    asset_type: Optional[str] = None
    attributes: dict = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class AssetTreeNode(BaseModel):
    """An asset plus its subtree-inclusive rollups, as returned by the tree endpoint.

    `device_count` and `active_alarm_count` include the asset's own devices **and**
    those of every descendant — a pump station's count includes its child pumps',
    or the number misleads.
    """

    id: UUID
    parent_id: Optional[UUID] = None
    site_id: UUID
    name: str
    asset_type: Optional[str] = None
    description: Optional[str] = None
    attributes: dict = Field(default_factory=dict)
    device_count: int = 0
    active_alarm_count: int = 0
    created_at: datetime
    updated_at: datetime
