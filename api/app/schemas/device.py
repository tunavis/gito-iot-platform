"""Device-related request and response schemas."""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
from datetime import datetime
from enum import Enum
from uuid import UUID


class DeviceStatus(str, Enum):
    """Device status enumeration."""
    ONLINE = "online"
    OFFLINE = "offline"
    IDLE = "idle"
    ERROR = "error"
    PROVISIONING = "provisioning"


class DeviceCreate(BaseModel):
    """Create device request."""
    name: str = Field(min_length=1, max_length=255, description="Device name")
    device_type: str = Field(min_length=1, max_length=100, description="Device type")
    attributes: dict = Field(default_factory=dict, description="Device attributes (JSON)")
    # Hierarchy fields
    organization_id: Optional[UUID] = Field(None, description="Organization ID")
    site_id: Optional[UUID] = Field(None, description="Site ID")
    device_group_id: Optional[UUID] = Field(None, description="Device group ID")
    # LoRaWAN fields (optional - for ChirpStack integration)
    lorawan_dev_eui: Optional[str] = Field(None, pattern="^[0-9A-Fa-f]{16}$", description="LoRaWAN Device EUI (16 hex chars)")
    chirpstack_app_id: Optional[str] = Field(None, description="ChirpStack application ID")
    device_profile_id: Optional[str] = Field(None, description="ChirpStack device profile UUID")


class DeviceUpdate(BaseModel):
    """Update device request."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    attributes: Optional[dict] = None
    # Hierarchy fields
    organization_id: Optional[UUID] = Field(None, description="Organization ID")
    site_id: Optional[UUID] = Field(None, description="Site ID")
    device_group_id: Optional[UUID] = Field(None, description="Device group ID")
    # LoRaWAN fields (optional)
    lorawan_dev_eui: Optional[str] = Field(None, pattern="^[0-9A-Fa-f]{16}$", description="LoRaWAN Device EUI (16 hex chars)")
    chirpstack_app_id: Optional[str] = Field(None, description="ChirpStack application ID")
    device_profile_id: Optional[str] = Field(None, description="ChirpStack device profile UUID")


class DeviceResponse(BaseModel):
    """Device response model."""
    id: UUID
    tenant_id: UUID
    name: str
    device_type: Optional[str] = None
    status: DeviceStatus
    last_seen: Optional[datetime] = None
    battery_level: Optional[float] = None
    signal_strength: Optional[int] = None
    attributes: dict
    # Hierarchy fields
    organization_id: Optional[UUID] = None
    site_id: Optional[UUID] = None
    device_group_id: Optional[UUID] = None
    # LoRaWAN fields
    lorawan_dev_eui: Optional[str] = None
    chirpstack_app_id: Optional[str] = None
    device_profile_id: Optional[str] = None
    chirpstack_synced: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
