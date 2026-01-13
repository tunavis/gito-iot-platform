"""Device group models - organize devices into logical units for bulk operations."""

from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from datetime import datetime
import uuid

from app.models.base import BaseModel


class DeviceGroup(BaseModel):
    """Device group - logical grouping of devices for bulk operations."""
    __tablename__ = "device_groups"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    membership_rule = Column(JSONB, default={}, nullable=False)  # Dynamic membership rules (e.g., tags, status)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_device_groups_tenant", "tenant_id"),
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
