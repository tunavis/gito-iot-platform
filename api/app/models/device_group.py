"""Device group models - organize devices into logical units for bulk operations."""

from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Index, Integer
from sqlalchemy.dialects.postgresql import UUID, JSONB
from datetime import datetime
import uuid

from app.models.base import BaseModel


class DeviceGroup(BaseModel):
    """Device group - logical grouping of devices for bulk operations."""
    __tablename__ = "device_groups"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Hierarchy: Groups belong to organizations and sites
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    site_id = Column(UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=True, index=True)
    
    name = Column(String(255), nullable=False)
    description = Column(Text)
    group_type = Column(String(50))  # logical, physical, functional
    membership_rule = Column(JSONB, default={}, nullable=False)  # Dynamic membership rules (e.g., tags, status)
    attributes = Column(JSONB, default={}, nullable=False)  # Custom attributes (renamed from metadata to avoid SQLAlchemy conflict)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_device_groups_tenant", "tenant_id"),
        Index("idx_device_groups_org", "organization_id"),
        Index("idx_device_groups_site", "site_id"),
    )


class GroupDevice(BaseModel):
    """Device group membership - explicit mapping of devices to groups."""
    __tablename__ = "group_devices"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id = Column(UUID(as_uuid=True), ForeignKey("device_groups.id", ondelete="CASCADE"), nullable=False, index=True)
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    added_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_group_devices_group", "group_id"),
        Index("idx_group_devices_device", "device_id"),
    )


class BulkOperation(BaseModel):
    """Bulk operations - track group-level operations like OTA or commands."""
    __tablename__ = "group_bulk_operations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    group_id = Column(UUID(as_uuid=True), ForeignKey("device_groups.id", ondelete="CASCADE"), nullable=False, index=True)
    operation_type = Column(String(50), nullable=False)  # bulk_ota, bulk_command, bulk_sync
    status = Column(String(50), default="queued", nullable=False)  # queued, running, completed, failed
    cadence_workflow_id = Column(String(255))  # Cadence workflow ID for tracking
    devices_total = Column(Integer, nullable=False)
    devices_completed = Column(Integer, default=0, nullable=False)
    devices_failed = Column(Integer, default=0, nullable=False)
    progress_percent = Column(Integer, default=0, nullable=False)
    operation_metadata = Column(JSONB, default={}, nullable=False)  # Operation-specific metadata
    error_message = Column(Text)
    started_at = Column(DateTime(timezone=True))
    completed_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_bulk_operations_tenant", "tenant_id"),
        Index("idx_bulk_operations_group", "group_id"),
        Index("idx_bulk_operations_status", "status"),
        Index("idx_bulk_operations_created_at", "created_at"),
    )
