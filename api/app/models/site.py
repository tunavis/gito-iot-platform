"""Site model - Physical locations with hierarchical nesting."""

from sqlalchemy import (
    Column, String, DateTime, ForeignKey, Text, Index
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from datetime import datetime
import uuid

from app.models.base import BaseModel


class Site(BaseModel):
    """
    Site - Physical location with hierarchical nesting support.
    
    Can represent buildings, floors, areas, or any physical location.
    Supports parent-child relationships for nested site structures:
    - Building → Floor → Room
    - Campus → Building → Wing → Floor
    """
    __tablename__ = "sites"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    organization_id = Column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    parent_site_id = Column(
        UUID(as_uuid=True),
        ForeignKey("sites.id", ondelete="CASCADE"),
        nullable=True
    )
    
    name = Column(String(255), nullable=False)
    site_type = Column(String(50))  # factory, warehouse, office, building, floor, room
    address = Column(Text)
    coordinates = Column(JSONB)  # {"lat": 51.5074, "lng": -0.1278}
    timezone = Column(String(50), default="UTC", nullable=False)
    attributes = Column(JSONB, default={}, nullable=False)  # Custom attributes
    
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_sites_tenant", "tenant_id"),
        Index("idx_sites_organization", "organization_id"),
        Index("idx_sites_parent", "parent_site_id"),
    )
