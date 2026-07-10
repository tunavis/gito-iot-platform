"""Device-related request and response schemas."""

from pydantic import BaseModel, Field, ConfigDict, model_validator
from typing import Optional, List
from datetime import datetime, timezone
from enum import Enum
from uuid import UUID

from app.services.device_status import DEFAULT_OFFLINE_THRESHOLD_SECONDS, is_effectively_offline


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
    device_type: Optional[str] = Field(None, max_length=100, description="Device type string")
    device_type_id: Optional[UUID] = Field(None, description="Device type template UUID")
    description: Optional[str] = Field(None, description="Device description")
    serial_number: Optional[str] = Field(None, max_length=255, description="Serial number")
    tags: Optional[List[str]] = Field(default=None, description="Device tags")
    attributes: dict = Field(default_factory=dict, description="Device attributes (JSON)")
    # Hierarchy fields
    organization_id: Optional[UUID] = Field(None, description="Organization ID")
    site_id: Optional[UUID] = Field(None, description="Site ID")
    device_group_id: Optional[UUID] = Field(None, description="Device group ID")
    # LoRaWAN fields
    dev_eui: Optional[str] = Field(None, pattern="^[0-9A-Fa-f]{16}$", description="LoRaWAN Device EUI (16 hex chars)")
    app_key: Optional[str] = Field(None, description="LoRaWAN Application Key")
    ttn_app_id: Optional[str] = Field(None, description="TTN application ID")
    device_profile_id: Optional[str] = Field(None, description="Device profile UUID")
    # MQTT fields
    mqtt_client_id: Optional[str] = Field(None, description="MQTT client ID override")
    # GPS (will be merged into attributes)
    latitude: Optional[float] = Field(None, description="GPS latitude")
    longitude: Optional[float] = Field(None, description="GPS longitude")


class DeviceUpdate(BaseModel):
    """Update device request."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    serial_number: Optional[str] = Field(None, max_length=255)
    tags: Optional[List[str]] = None
    attributes: Optional[dict] = None
    # Hierarchy fields
    organization_id: Optional[UUID] = Field(None, description="Organization ID")
    site_id: Optional[UUID] = Field(None, description="Site ID")
    device_group_id: Optional[UUID] = Field(None, description="Device group ID")
    # LoRaWAN fields
    dev_eui: Optional[str] = Field(None, pattern="^[0-9A-Fa-f]{16}$", description="LoRaWAN Device EUI (16 hex chars)")
    ttn_app_id: Optional[str] = Field(None, description="TTN application ID")
    device_profile_id: Optional[str] = Field(None, description="Device profile UUID")


class DeviceResponse(BaseModel):
    """Device response model."""
    id: UUID
    tenant_id: UUID
    name: str
    device_type: Optional[str] = None
    device_type_id: Optional[UUID] = None
    description: Optional[str] = None
    serial_number: Optional[str] = None
    tags: Optional[list] = None
    status: DeviceStatus
    last_seen: Optional[datetime] = None
    battery_level: Optional[float] = None
    signal_strength: Optional[int] = None
    attributes: dict
    # Hierarchy fields
    organization_id: Optional[UUID] = None
    site_id: Optional[UUID] = None
    device_group_id: Optional[UUID] = None
    # LoRaWAN fields (use actual DB column names)
    dev_eui: Optional[str] = None
    ttn_app_id: Optional[str] = None
    device_profile_id: Optional[str] = None
    ttn_synced: bool = False
    created_at: datetime
    updated_at: datetime
    # Per-device-type threshold — set by router before validation, excluded from JSON
    offline_threshold: Optional[int] = Field(None, exclude=True)

    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="after")
    def compute_effective_status(self) -> "DeviceResponse":
        """Override ONLINE → OFFLINE when last_seen is missing or stale.

        See app/services/device_status.py — the single shared definition of
        "effectively offline", also used by the analytics endpoints so uptime/
        fleet-overview numbers can't diverge from what the device list shows.
        """
        threshold = self.offline_threshold or DEFAULT_OFFLINE_THRESHOLD_SECONDS
        if is_effectively_offline(self.status.value, self.last_seen, threshold):
            self.status = DeviceStatus.OFFLINE
        return self
