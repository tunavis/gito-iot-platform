"""Pydantic schemas for notification system."""

from enum import Enum
from typing import List, Optional, Dict, Any
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, Field


class ChannelTypeEnum(str, Enum):
    """Supported notification channels."""
    EMAIL = "email"
    SLACK = "slack"
    WEBHOOK = "webhook"
    APNS = "apns"
    FCM = "fcm"
    SMS = "sms"


class NotificationStatusEnum(str, Enum):
    """Notification delivery status."""
    PENDING = "pending"
    SENDING = "sending"
    SENT = "sent"
    FAILED = "failed"
    BOUNCED = "bounced"
    SKIPPED = "skipped"


class CreateNotificationChannelSchema(BaseModel):
    """Create a notification channel."""
    channel_type: ChannelTypeEnum
    config: Dict[str, Any] = Field(..., description="Channel-specific config")
    enabled: bool = Field(default=True)


class NotificationChannelResponseSchema(BaseModel):
    """Response for notification channel."""
    id: UUID
    user_id: UUID
    channel_type: ChannelTypeEnum
    config: Dict[str, Any]
    enabled: bool
    verified: bool
    verified_at: Optional[datetime]
    last_used_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class UpdateNotificationChannelSchema(BaseModel):
    """Update notification channel."""
    enabled: Optional[bool] = None
    config: Optional[Dict[str, Any]] = None


class NotificationPreferencesSchema(BaseModel):
    """User notification preferences."""
    quiet_hours_enabled: bool = Field(default=False)
    quiet_hours_start: str = Field(default="22:00", description="HH:MM format")
    quiet_hours_end: str = Field(default="08:00", description="HH:MM format")
    timezone: str = Field(default="UTC")
    muted_rules: List[UUID] = Field(default_factory=list)
    email_digest_enabled: bool = Field(default=False)
    email_digest_frequency: str = Field(default="daily")


class CreateNotificationRuleSchema(BaseModel):
    """Link alert rule to notification channel."""
    alert_rule_id: UUID
    channel_id: UUID
    enabled: bool = Field(default=True)


class NotificationRuleResponseSchema(BaseModel):
    """Response for notification rule."""
    id: UUID
    alert_rule_id: UUID
    channel_id: UUID
    enabled: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class NotificationResponseSchema(BaseModel):
    """Response for sent notification."""
    id: UUID
    alert_event_id: UUID
    channel_id: UUID
    channel_type: ChannelTypeEnum
    recipient: str
    status: NotificationStatusEnum
    delivery_status: Optional[str]
    error_message: Optional[str]
    retry_count: int
    next_retry_at: Optional[datetime]
    sent_at: Optional[datetime]
    delivered_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class NotificationListResponseSchema(BaseModel):
    """List notification response."""
    id: UUID
    alert_event_id: UUID
    channel_type: str
    recipient: str
    status: str
    sent_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class NotificationTemplateSchema(BaseModel):
    """Create/update notification template."""
    channel_type: str = Field(..., description="email, slack, webhook")
    alert_type: Optional[str] = Field(None, description="Optional - specific alert type")
    name: str
    subject: Optional[str] = None
    body: str
    variables: List[str] = Field(default_factory=list)
    enabled: bool = Field(default=True)


class NotificationTemplateResponseSchema(BaseModel):
    """Response for notification template."""
    id: UUID
    channel_type: str
    alert_type: Optional[str]
    name: str
    subject: Optional[str]
    body: str
    variables: List[str]
    enabled: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ResendNotificationSchema(BaseModel):
    """Request to resend a notification."""
    alert_event_id: UUID


class NotificationStatsSchema(BaseModel):
    """Notification delivery statistics."""
    total_sent: int = 0
    total_pending: int = 0
    total_failed: int = 0
    success_rate: float = 0.0
    channels: Dict[str, int] = Field(default_factory=dict)
