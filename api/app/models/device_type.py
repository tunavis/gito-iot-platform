"""Device Type model - templates for device registration (AWS IoT / Cumulocity pattern)."""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, String, Text, Integer, Boolean, DateTime, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship

from app.models.base import BaseModel


class DeviceType(BaseModel):
    """Device Type - reusable templates for device registration.
    
    Similar to AWS IoT Device Types and Cumulocity Device Profiles.
    Each tenant can define their own device types with:
    - Data model (what telemetry fields the device sends)
    - Capabilities (what the device can do)
    - Default settings and configuration
    - Protocol/connectivity settings
    
    Example:
        name='Temperature Sensor v2',
        manufacturer='Acme IoT',
        data_model=[
            {"name": "temperature", "type": "float", "unit": "°C"},
            {"name": "humidity", "type": "float", "unit": "%"},
            {"name": "battery", "type": "int", "unit": "%"}
        ],
        capabilities=["telemetry", "firmware_ota", "remote_config"]
    """
    __tablename__ = "device_types"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Basic Info
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    manufacturer = Column(String(255), nullable=True)
    model = Column(String(255), nullable=True)
    category = Column(String(50), nullable=False, default="sensor")  # sensor, gateway, actuator, tracker, meter, camera
    
    # Visual
    icon = Column(String(50), nullable=True, default="cpu")  # lucide icon name
    color = Column(String(20), nullable=True, default="#6366f1")  # hex color
    
    # Data Model - defines what telemetry this device type sends
    # [{name, type, unit, description, min, max}, ...]
    data_model = Column(JSONB, nullable=True, default=list)
    
    # Capabilities - what the device can do
    # ["telemetry", "commands", "firmware_ota", "remote_config", "location", "alerts"]
    capabilities = Column(JSONB, nullable=True, default=list)
    
    # Default Settings - applied when creating devices of this type
    # {heartbeat_interval, telemetry_interval, ...}
    default_settings = Column(JSONB, nullable=True, default=dict)
    
    # Protocol/Connectivity Configuration
    # {protocol: "mqtt"|"lorawan"|"http", ...}
    connectivity = Column(JSONB, nullable=True, default=dict)
    
    # Extra Metadata - custom fields (renamed from 'metadata' to avoid SQLAlchemy conflict)
    extra_metadata = Column("metadata", JSONB, nullable=True, default=dict)
    
    # Status
    is_active = Column(Boolean, default=True, nullable=False)
    device_count = Column(Integer, default=0, nullable=False)  # cached count
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_device_types_tenant", "tenant_id"),
        Index("idx_device_types_category", "category"),
        Index("idx_device_types_active", "is_active"),
    )

    def __repr__(self):
        return f"<DeviceType {self.name} ({self.category})>"
