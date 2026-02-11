"""Base SQLAlchemy models - enforces multi-tenancy on all tables."""

from sqlalchemy import (
    Column, String, DateTime, ForeignKey, CheckConstraint,
    Text, Integer, Float, Index, Boolean
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
    """IoT Device - scoped to tenant with hierarchical organization."""
    __tablename__ = "devices"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Hierarchy: Organization → Site → Device Group → Device
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True, index=True)
    site_id = Column(UUID(as_uuid=True), ForeignKey("sites.id", ondelete="SET NULL"), nullable=True, index=True)
    device_group_id = Column(UUID(as_uuid=True), ForeignKey("device_groups.id", ondelete="SET NULL"), nullable=True, index=True)
    
    name = Column(String(255), nullable=False)
    device_type = Column(String(100), nullable=False)
    dev_eui = Column(String(16), nullable=True)  # For LoRaWAN (alias for lorawan_dev_eui)
    status = Column(String(50), default="offline", nullable=False)
    last_seen = Column(DateTime(timezone=True))
    battery_level = Column(Float)
    signal_strength = Column(Integer)
    attributes = Column(JSONB, default={}, nullable=False)  # Device-specific attributes
    ttn_app_id = Column(String(100), nullable=True)  # TTN Server app ID (provider-agnostic)
    device_profile_id = Column(String(100), nullable=True)  # Device profile UUID
    ttn_synced = Column(Boolean, default=False, nullable=False)  # Whether device is synced to TTN server
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_devices_status", "status"),
        Index("idx_devices_last_seen", "last_seen"),
        Index("idx_devices_tenant_dev_eui", "tenant_id", "dev_eui", unique=True),
        Index("idx_devices_organization", "organization_id"),
        Index("idx_devices_site", "site_id"),
        Index("idx_devices_group", "device_group_id"),
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


class AlertRuleCondition(BaseModel):
    """Condition in a composite alert rule - supports multi-condition AND/OR logic."""
    __tablename__ = "alert_rule_conditions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    rule_id = Column(UUID(as_uuid=True), ForeignKey("alert_rules.id", ondelete="CASCADE"), nullable=False, index=True)
    field = Column(String(100), nullable=False)  # temperature, humidity, battery, rssi, pressure, etc.
    operator = Column(String(10), nullable=False)  # >, <, >=, <=, ==, !=
    threshold = Column(Float, nullable=False)
    weight = Column(Integer, default=1, nullable=False)  # For weighted scoring (1-100)
    sequence = Column(Integer, default=0, nullable=False)  # Execution order for complex rules
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_alert_conditions_rule", "rule_id"),
        CheckConstraint("operator IN ('>', '<', '>=', '<=', '==', '!=')", name="valid_condition_operator"),
        CheckConstraint("weight >= 1 AND weight <= 100", name="valid_condition_weight"),
    )


class AlertEvent(BaseModel):
    """Alarm events - Cumulocity-style alarms with severity levels and acknowledgment workflow."""
    __tablename__ = "alert_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    alert_rule_id = Column(UUID(as_uuid=True), ForeignKey("alert_rules.id", ondelete="CASCADE"), nullable=True, index=True)
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    metric_name = Column(String(50), nullable=False)
    metric_value = Column(Float)
    message = Column(Text)
    
    # Alarm system fields
    severity = Column(String(20), default="MAJOR", nullable=False)  # CRITICAL, MAJOR, MINOR, WARNING
    status = Column(String(20), default="ACTIVE", nullable=False)  # ACTIVE, ACKNOWLEDGED, CLEARED
    alarm_type = Column(String(100))  # temperature_threshold, communication_lost, etc.
    source = Column(String(100))  # Source sensor/component
    
    # Acknowledgment tracking
    acknowledged_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    acknowledged_at = Column(DateTime(timezone=True))
    cleared_at = Column(DateTime(timezone=True))
    
    # Notification tracking
    notification_sent = Column(Boolean, default=False, nullable=False)
    notification_sent_at = Column(DateTime(timezone=True))
    
    fired_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False, index=True)

    __table_args__ = (
        Index("idx_alert_events_rule", "alert_rule_id"),
        Index("idx_alert_events_device", "device_id"),
        Index("idx_alert_events_severity", "severity"),
        Index("idx_alert_events_status", "status"),
        Index("idx_alert_events_alarm_type", "tenant_id", "alarm_type", "status"),
        CheckConstraint("severity IN ('CRITICAL', 'MAJOR', 'MINOR', 'WARNING')", name="valid_severity"),
        CheckConstraint("status IN ('ACTIVE', 'ACKNOWLEDGED', 'CLEARED')", name="valid_alarm_status"),
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


class Telemetry(BaseModel):
    """
    Telemetry time-series data - key-value storage for unlimited metrics.

    Industry-standard design (ThingsBoard/Cumulocity pattern):
    - One row per metric per timestamp
    - Supports any metric name dynamically
    - Efficient queries for specific metrics
    - Works with TimescaleDB hypertables
    """
    __tablename__ = "telemetry"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)

    # Key-value metric storage
    metric_key = Column(String(100), nullable=False)  # "temperature", "humidity", "custom_sensor_1", etc.
    metric_value = Column(Float, nullable=True)  # Numeric value (most common)
    metric_value_str = Column(String(500), nullable=True)  # String value (status, mode, etc.)
    metric_value_json = Column(JSONB, nullable=True)  # Complex/nested values

    # Unit hint from device type schema (optional, for display)
    unit = Column(String(20), nullable=True)  # "°C", "%", "m³/hr", etc.

    # Timestamps
    ts = Column(DateTime(timezone=True), nullable=False)  # Measurement timestamp
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        # Primary query pattern: device + metric + time range
        Index("idx_telemetry_device_metric_ts", "device_id", "metric_key", "ts"),
        # Tenant isolation queries
        Index("idx_telemetry_tenant_device", "tenant_id", "device_id"),
        # Time-based queries (for TimescaleDB retention policies)
        Index("idx_telemetry_ts", "ts"),
        # Latest value queries (DISTINCT ON device_id, metric_key ORDER BY ts DESC)
        Index("idx_telemetry_latest", "device_id", "metric_key", "ts", postgresql_ops={"ts": "DESC"}),
    )


# Keep alias for backwards compatibility during migration
TelemetryHot = Telemetry
