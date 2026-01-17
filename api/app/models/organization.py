"""Organization model - Sub-customers within a tenant (SaaS within SaaS)."""

from sqlalchemy import (
    Column, String, DateTime, ForeignKey, CheckConstraint, Text, Index
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from datetime import datetime
import uuid

from app.models.base import BaseModel


class Organization(BaseModel):
    """
    Organization - Sub-customer within a tenant.
    
    Enables SaaS reselling: Your customers can have their own customers.
    Each organization can have multiple sites and device groups.
    Maps to ChirpStack Application for LoRaWAN device management.
    """
    __tablename__ = "organizations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    name = Column(String(255), nullable=False)
    slug = Column(String(100), nullable=False)
    description = Column(Text)
    billing_contact = Column(String(255))
    
    # ChirpStack Integration
    chirpstack_app_id = Column(String(100))  # ChirpStack Application ID
    
    status = Column(String(50), default="active", nullable=False)
    attributes = Column(JSONB, default={}, nullable=False)  # Custom attributes
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_organizations_tenant", "tenant_id"),
        Index("idx_organizations_slug", "tenant_id", "slug", unique=True),
        Index(
            "idx_organizations_chirpstack",
            "chirpstack_app_id",
            postgresql_where="chirpstack_app_id IS NOT NULL"
        ),
        CheckConstraint(
            "status IN ('active', 'inactive', 'suspended')",
            name="valid_org_status"
        ),
    )
