"""Notification system ORM models - supports email, Slack, webhooks, and mobile push."""

from sqlalchemy import (
    Column, String, DateTime, ForeignKey, CheckConstraint,
    Text, Integer, Boolean, Index
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from datetime import datetime
import uuid

from app.models.base import BaseModel


class NotificationChannel(BaseModel):
    """User notification endpoint - email, Slack, webhook, or mobile push."""
    __tablename__ = "notification_channels"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    channel_type = Column(String(50), nullable=False)  # email, slack, webhook, apns, fcm, sms
    config = Column(JSONB, nullable=False)  # {email: "...", slack_webhook_url: "...", webhook_url: "..."}
    enabled = Column(Boolean, default=True, nullable=False)
    verified = Column(Boolean, default=False, nullable=False)  # For email verification
    verified_at = Column(DateTime(timezone=True))
    last_used_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_notification_channels_tenant", "tenant_id"),
        Index("idx_notification_channels_user", "user_id"),
        Index("idx_notification_channels_enabled", "enabled"),
        Index("idx_notification_channels_type", "channel_type"),
        CheckConstraint(
            "channel_type IN ('email', 'slack', 'webhook', 'apns', 'fcm', 'sms')",
            name="valid_notification_channel_type"
        ),
    )


class NotificationRule(BaseModel):
    """Links alert rules to notification channels."""
    __tablename__ = "notification_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    alert_rule_id = Column(UUID(as_uuid=True), ForeignKey("alert_rules.id", ondelete="CASCADE"), nullable=False, index=True)
    channel_id = Column(UUID(as_uuid=True), ForeignKey("notification_channels.id", ondelete="CASCADE"), nullable=False, index=True)
    enabled = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_notification_rules_alert", "alert_rule_id"),
        Index("idx_notification_rules_channel", "channel_id"),
        Index("idx_notification_rules_enabled", "enabled"),
    )


class Notification(BaseModel):
    """Sent notifications - audit trail and delivery tracking."""
    __tablename__ = "notifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    alert_event_id = Column(UUID(as_uuid=True), ForeignKey("alert_events.id", ondelete="CASCADE"), nullable=False, index=True)
    channel_id = Column(UUID(as_uuid=True), ForeignKey("notification_channels.id", ondelete="CASCADE"), nullable=False, index=True)
    channel_type = Column(String(50), nullable=False)  # Denormalized for easier querying
    recipient = Column(String(255), nullable=False)  # email, phone, webhook URL, etc.
    status = Column(String(50), default="pending", nullable=False)  # pending, sending, sent, failed, bounced, skipped
    delivery_status = Column(String(50))  # success, permanent_failure, temporary_failure, invalid_address, rate_limited
    error_message = Column(Text)
    retry_count = Column(Integer, default=0, nullable=False)
    next_retry_at = Column(DateTime(timezone=True))
    sent_at = Column(DateTime(timezone=True))
    delivered_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_notifications_tenant", "tenant_id"),
        Index("idx_notifications_alert_event", "alert_event_id"),
        Index("idx_notifications_channel", "channel_id"),
        Index("idx_notifications_status", "status"),
        Index("idx_notifications_recipient", "recipient"),
        Index("idx_notifications_created", "created_at", postgresql_using="DESC"),
        Index("idx_notifications_retry", "status", "next_retry_at", postgresql_where="status = 'pending'"),
        CheckConstraint(
            "status IN ('pending', 'sending', 'sent', 'failed', 'bounced', 'skipped')",
            name="valid_notification_status"
        ),
        CheckConstraint(
            "delivery_status IS NULL OR delivery_status IN ('success', 'permanent_failure', 'temporary_failure', 'invalid_address', 'rate_limited')",
            name="valid_delivery_status"
        ),
    )


class NotificationQueue(BaseModel):
    """Queue for pending notifications awaiting dispatch."""
    __tablename__ = "notification_queue"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    alert_event_id = Column(UUID(as_uuid=True), ForeignKey("alert_events.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(50), default="pending", nullable=False)  # pending, processing, completed, failed
    error_message = Column(Text)
    attempted_at = Column(DateTime(timezone=True))
    processed_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_notification_queue_status", "status"),
        Index("idx_notification_queue_tenant", "tenant_id"),
        Index("idx_notification_queue_created", "created_at", postgresql_using="DESC"),
        Index("idx_notification_queue_retry", "status", "created_at", postgresql_where="status = 'pending'"),
        CheckConstraint(
            "status IN ('pending', 'processing', 'completed', 'failed')",
            name="valid_notification_queue_status"
        ),
    )


class NotificationTemplate(BaseModel):
    """Customizable notification message templates."""
    __tablename__ = "notification_templates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    channel_type = Column(String(50), nullable=False)  # email, slack, webhook
    alert_type = Column(String(100))  # Optional: specific alert type, null = default
    name = Column(String(255), nullable=False)
    subject = Column(String(500))  # For email only
    body = Column(Text, nullable=False)  # Jinja2 template syntax
    variables = Column(JSONB, default={}, nullable=False)  # List of available template variables
    enabled = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_notification_templates_tenant", "tenant_id"),
        Index("idx_notification_templates_channel", "channel_type"),
        Index("idx_notification_templates_enabled", "enabled"),
        CheckConstraint(
            "channel_type IN ('email', 'slack', 'webhook')",
            name="valid_template_channel_type"
        ),
    )
