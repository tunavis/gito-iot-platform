"""OTA Firmware and campaign models for Phase 3."""

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


class FirmwareVersionBase(BaseModel):
    """Base firmware version model."""

    name: str = Field(..., min_length=1, max_length=255)
    version: str = Field(..., min_length=1, max_length=50, pattern=r"^\d+\.\d+\.\d+$")
    url: str = Field(..., max_length=2048)
    size_bytes: int = Field(..., gt=0)
    hash: str = Field(..., min_length=64, max_length=64)  # SHA256
    release_type: str = Field(default="beta", pattern=r"^(beta|production|hotfix)$")
    changelog: Optional[str] = None


class FirmwareVersionCreate(FirmwareVersionBase):
    """Create firmware version request."""

    pass


class FirmwareVersionUpdate(BaseModel):
    """Update firmware version request."""

    release_type: Optional[str] = Field(None, pattern=r"^(beta|production|hotfix)$")
    changelog: Optional[str] = None


class FirmwareVersionResponse(FirmwareVersionBase):
    """Firmware version response."""

    id: UUID
    tenant_id: UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class DeviceFirmwareHistoryResponse(BaseModel):
    """Device firmware history response."""

    id: UUID
    device_id: UUID
    firmware_version_id: Optional[UUID]
    previous_version_id: Optional[UUID]
    status: str  # pending, in_progress, completed, failed, rolled_back
    progress_percent: int
    error_message: Optional[str]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class OTACampaignBase(BaseModel):
    """Base OTA campaign model."""

    name: str = Field(..., min_length=1, max_length=255)
    firmware_version_id: UUID
    rollout_strategy: str = Field(
        default="immediate", pattern=r"^(immediate|staggered|scheduled)$"
    )
    devices_per_hour: Optional[int] = Field(default=100, ge=1)
    auto_rollback_threshold: Optional[float] = Field(default=0.1, ge=0.0, le=1.0)
    scheduled_at: Optional[datetime] = None


class OTACampaignCreate(OTACampaignBase):
    """Create OTA campaign request."""

    pass


class OTACampaignUpdate(BaseModel):
    """Update OTA campaign request."""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    rollout_strategy: Optional[str] = Field(None, pattern=r"^(immediate|staggered|scheduled)$")
    devices_per_hour: Optional[int] = Field(None, ge=1)
    auto_rollback_threshold: Optional[float] = Field(None, ge=0.0, le=1.0)


class OTACampaignExecute(BaseModel):
    """Execute OTA campaign request."""

    device_ids: Optional[list[UUID]] = None  # Specific devices, or all if None
    start_immediately: bool = True


class OTACampaignResponse(OTACampaignBase):
    """OTA campaign response."""

    id: UUID
    tenant_id: UUID
    status: str  # draft, scheduled, in_progress, completed, failed, rolled_back
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    created_by: Optional[UUID]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class OTACampaignDeviceResponse(BaseModel):
    """OTA campaign device status response."""

    id: UUID
    campaign_id: UUID
    device_id: UUID
    status: str  # pending, in_progress, completed, failed, skipped
    progress_percent: int
    error_message: Optional[str]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]

    class Config:
        from_attributes = True


class DeviceGroupBase(BaseModel):
    """Base device group model."""

    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    membership_rule: Optional[dict] = None  # {tags: [location:lab, type:sensor]}


class DeviceGroupCreate(DeviceGroupBase):
    """Create device group request."""

    pass


class DeviceGroupUpdate(BaseModel):
    """Update device group request."""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    membership_rule: Optional[dict] = None


class DeviceGroupResponse(DeviceGroupBase):
    """Device group response."""

    id: UUID
    tenant_id: UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class NotificationChannelConfig(BaseModel):
    """Notification channel configuration."""

    channel_type: str = Field(..., pattern=r"^(email|sms|slack|webhook|pagerduty)$")
    enabled: bool = True
    config: dict  # {phone: +1234567890} or {slack_channel_id: C123...} or {url: ...}


class NotificationSettingsResponse(BaseModel):
    """User notification settings response."""

    id: UUID
    user_id: UUID
    channel_type: str
    enabled: bool
    config: dict
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
