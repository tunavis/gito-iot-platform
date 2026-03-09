"""Event model — IoT event stream (device lifecycle, alarm changes, custom events)."""

from datetime import datetime
import uuid

from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.models.base import BaseModel


class Event(BaseModel):
    """IoT platform event — one row per discrete occurrence."""
    __tablename__ = "events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="SET NULL"), nullable=True)

    # Classification
    event_type = Column(String(100), nullable=False)   # device.connected, alarm.raised, telemetry.threshold_crossed …
    severity = Column(String(20), nullable=False, default="INFO")  # INFO, WARNING, ERROR, CRITICAL

    # Human-readable description
    message = Column(Text, nullable=True)

    # Arbitrary extra data (alarm id, metric name, old/new value …)
    payload = Column(JSONB, nullable=False, default={})

    ts = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("idx_events_tenant_ts",   "tenant_id", "ts"),
        Index("idx_events_device_ts",   "device_id", "ts"),
        Index("idx_events_tenant_type", "tenant_id", "event_type", "ts"),
    )
