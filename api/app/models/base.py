"""Base SQLAlchemy models - enforces multi-tenancy on all tables."""

from sqlalchemy import (
    Column, String, DateTime, ForeignKey, CheckConstraint,
    Text, Integer, Float, Index
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import declarative_base
from datetime import datetime
import uuid

# Base for all models
BaseModel = declarative_base()


class Tenant(BaseModel):
    """SaaS Tenant - top-level organization."""
    __tablename__ = "tenants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    slug = Column(String(100), unique=True, nullable=False)
    status = Column(String(50), default="active", nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint("status IN ('active', 'inactive', 'suspended')", name="valid_tenant_status"),
    )


class User(BaseModel):
    """User account - scoped to tenant."""
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    email = Column(String(255), nullable=False)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(255))
    role = Column(String(50), default="VIEWER", nullable=False)
    status = Column(String(50), default="active")
    last_login_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_users_tenant_email", "tenant_id", "email", unique=True),
        CheckConstraint(
            "role IN ('SUPER_ADMIN', 'TENANT_ADMIN', 'SITE_ADMIN', 'CLIENT', 'VIEWER')",
            name="valid_user_role"
        ),
    )


class Device(BaseModel):
    """IoT Device - scoped to tenant."""
    __tablename__ = "devices"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    device_type = Column(String(100), nullable=False)
    dev_eui = Column(String(16), nullable=True)  # For LoRaWAN
    status = Column(String(50), default="offline", nullable=False)
    last_seen = Column(DateTime(timezone=True))
    battery_level = Column(Float)
    signal_strength = Column(Integer)
    attributes = Column(JSONB, default={}, nullable=False)  # Device-specific attributes
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_devices_status", "status"),
        Index("idx_devices_last_seen", "last_seen"),
        Index("idx_devices_tenant_dev_eui", "tenant_id", "dev_eui", unique=True),
        CheckConstraint(
            "status IN ('online', 'offline', 'idle', 'error', 'provisioning')",
            name="valid_device_status"
        ),
    )


class DeviceCredential(BaseModel):
    """Device authentication credentials - hashed and tenant-scoped."""
    __tablename__ = "device_credentials"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    credential_type = Column(String(50), nullable=False)  # mqtt_password, device_token, api_key
    credential_hash = Column(String(255), nullable=False)
    username = Column(String(255))  # For MQTT: tenant_id:device_id
    status = Column(String(50), default="active")
    expires_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    rotated_at = Column(DateTime(timezone=True))

    __table_args__ = (
        Index("idx_creds_tenant_device", "tenant_id", "device_id"),
        CheckConstraint(
            "credential_type IN ('mqtt_password', 'device_token', 'api_key')",
            name="valid_cred_type"
        ),
    )


class AlertRule(BaseModel):
    """Threshold-based alert rules - tenant-scoped, device-specific."""
    __tablename__ = "alert_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    metric = Column(String(50), nullable=False)  # temperature, humidity, battery, rssi, pressure
    operator = Column(String(10), nullable=False)  # gt, gte, lt, lte, eq, neq
    threshold = Column(Float, nullable=False)
    cooldown_minutes = Column(Integer, default=5, nullable=False)
    active = Column(String(1), default="1", nullable=False)  # Boolean as string for SQL compatibility
    last_fired_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_alert_rules_device", "device_id"),
        Index("idx_alert_rules_active", "active"),
        CheckConstraint("metric IN ('temperature', 'humidity', 'battery', 'rssi', 'pressure')", name="valid_alert_metric"),
        CheckConstraint("operator IN ('gt', 'gte', 'lt', 'lte', 'eq', 'neq')", name="valid_alert_operator"),
    )


class AlertEvent(BaseModel):
    """Alert firing events - immutable history of threshold breaches."""
    __tablename__ = "alert_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    alert_rule_id = Column(UUID(as_uuid=True), ForeignKey("alert_rules.id", ondelete="CASCADE"), nullable=False, index=True)
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    metric_name = Column(String(50), nullable=False)
    metric_value = Column(Float)
    message = Column(Text)
    notification_sent = Column(String(1), default="0", nullable=False)
    notification_sent_at = Column(DateTime(timezone=True))
    fired_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False, index=True)

    __table_args__ = (
        Index("idx_alert_events_rule", "alert_rule_id"),
        Index("idx_alert_events_device", "device_id"),
    )


class AuditLog(BaseModel):
    """User action audit trail - immutable log for compliance."""
    __tablename__ = "audit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    action = Column(String(100), nullable=False)  # create, update, delete, login, etc.
    resource_type = Column(String(100))  # device, user, alert, etc.
    resource_id = Column(UUID(as_uuid=True))
    changes = Column(JSONB)  # Before/after for updates
    ip_address = Column(String(45))
    user_agent = Column(Text)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False, index=True)

    __table_args__ = (
        Index("idx_audit_user", "user_id"),
        Index("idx_audit_resource", "resource_type", "resource_id"),
    )
