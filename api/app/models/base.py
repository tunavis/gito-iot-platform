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
    tenant_metadata = Column("metadata", JSONB, nullable=False, default={})  # Added by migration 007 ('metadata' reserved in SA)
    # Added by migration 009 (tenant hierarchy)
    parent_tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=True, index=True)
    tenant_type = Column(String(50), nullable=False, default="client")  # management | client | sub_client
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
    device_type_id = Column(UUID(as_uuid=True), ForeignKey("device_types.id", ondelete="SET NULL"), nullable=True, index=True)
    description = Column(Text, nullable=True)
    serial_number = Column(String(255), nullable=True)
    tags = Column(JSONB, default=[], nullable=True)
    dev_eui = Column(String(16), nullable=True)  # For LoRaWAN
    status = Column(String(50), default="offline", nullable=False)
    last_seen = Column(DateTime(timezone=True))
    battery_level = Column(Float)
    signal_strength = Column(Integer)
    attributes = Column(JSONB, default={}, nullable=False)  # Device-specific attributes
    ttn_app_id = Column(String(100), nullable=True)  # TTN Server app ID (provider-agnostic)
    device_profile_id = Column(String(100), nullable=True)  # Device profile UUID
    ttn_synced = Column(Boolean, default=False, nullable=False)  # Whether device is synced to TTN server
    gateway_id = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="SET NULL"), nullable=True, index=True)
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


class DeviceCommand(BaseModel):
    """RPC command sent to a device — tracks full lifecycle (Option B: request-response correlation)."""
    __tablename__ = "device_commands"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    command_name = Column(String(100), nullable=False)
    parameters = Column(JSONB, default={})
    status = Column(String(20), default="pending", nullable=False)
    response = Column(JSONB, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("idx_device_commands_tenant", "tenant_id"),
        Index("idx_device_commands_device", "device_id"),
        Index("idx_device_commands_status", "status"),
        CheckConstraint(
            "status IN ('pending', 'sent', 'delivered', 'executed', 'failed', 'timed_out')",
            name="valid_command_status"
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
    - TimescaleDB hypertable: partitioned by ts (7-day chunks)

    Primary key is (id, ts) because TimescaleDB requires the partition column
    (ts) to be part of any unique constraint on the hypertable.
    """
    __tablename__ = "telemetry"

    # Composite PK required by TimescaleDB: any unique index must include ts
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ts = Column(DateTime(timezone=True), nullable=False, primary_key=True)  # also PK for hypertable

    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)

    # Key-value metric storage
    metric_key = Column(String(100), nullable=False)  # "temperature", "humidity", "custom_sensor_1", etc.
    metric_value = Column(Float, nullable=True)  # Numeric value (most common)
    metric_value_str = Column(String(500), nullable=True)  # String value (status, mode, etc.)
    metric_value_json = Column(JSONB, nullable=True)  # Complex/nested values

    # Unit hint from device type schema (optional, for display)
    unit = Column(String(20), nullable=True)  # "°C", "%", "m³/hr", etc.

    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        # Primary query pattern: device + metric + time range
        Index("idx_telemetry_device_metric_ts", "device_id", "metric_key", "ts"),
        # Tenant isolation queries
        Index("idx_telemetry_tenant_device", "tenant_id", "device_id"),
        # Latest value queries (DISTINCT ON device_id, metric_key ORDER BY ts DESC)
        Index("idx_telemetry_latest", "device_id", "metric_key", "ts", postgresql_ops={"ts": "DESC"}),
    )


# ---------------------------------------------------------------------------
# OTA Firmware Management
# ---------------------------------------------------------------------------

class FirmwareVersion(BaseModel):
    """Firmware binary metadata - one row per firmware release."""
    __tablename__ = "firmware_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    version = Column(String(50), nullable=False)          # semver: 1.2.3
    url = Column(String(2048), nullable=False)             # S3 / CDN URL
    size_bytes = Column(Integer, nullable=False)
    hash = Column(String(64), nullable=False)              # SHA-256
    release_type = Column(String(20), default="beta", nullable=False)  # beta|production|hotfix
    changelog = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_firmware_tenant", "tenant_id"),
        CheckConstraint("release_type IN ('beta', 'production', 'hotfix')", name="valid_release_type"),
    )


class OTACampaign(BaseModel):
    """Firmware update campaign - targets multiple devices."""
    __tablename__ = "ota_campaigns"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    firmware_version_id = Column(UUID(as_uuid=True), ForeignKey("firmware_versions.id", ondelete="RESTRICT"), nullable=False)
    rollout_strategy = Column(String(20), default="immediate", nullable=False)  # immediate|staggered|scheduled
    devices_per_hour = Column(Integer, default=100, nullable=False)
    auto_rollback_threshold = Column(Float, default=0.1, nullable=False)  # fraction 0-1
    status = Column(String(20), default="draft", nullable=False)  # draft|scheduled|in_progress|completed|failed|rolled_back
    scheduled_at = Column(DateTime(timezone=True), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_ota_campaigns_tenant", "tenant_id"),
        CheckConstraint("rollout_strategy IN ('immediate', 'staggered', 'scheduled')", name="valid_rollout_strategy"),
        CheckConstraint("status IN ('draft', 'scheduled', 'in_progress', 'completed', 'failed', 'rolled_back')", name="valid_campaign_status"),
    )


class OTACampaignDevice(BaseModel):
    """Per-device status within an OTA campaign."""
    __tablename__ = "ota_campaign_devices"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id = Column(UUID(as_uuid=True), ForeignKey("ota_campaigns.id", ondelete="CASCADE"), nullable=False, index=True)
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    status = Column(String(20), default="pending", nullable=False)  # pending|in_progress|completed|failed|skipped
    progress_percent = Column(Integer, default=0, nullable=False)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("idx_ota_campaign_devices_device", "device_id"),
        CheckConstraint("status IN ('pending', 'in_progress', 'completed', 'failed', 'skipped')", name="valid_device_ota_status"),
    )


class DeviceFirmwareHistory(BaseModel):
    """History of all firmware changes on a device."""
    __tablename__ = "device_firmware_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    firmware_version_id = Column(UUID(as_uuid=True), ForeignKey("firmware_versions.id", ondelete="SET NULL"), nullable=True)
    previous_version_id = Column(UUID(as_uuid=True), ForeignKey("firmware_versions.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(20), default="pending", nullable=False)  # pending|in_progress|completed|failed|rolled_back
    progress_percent = Column(Integer, default=0, nullable=False)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint("status IN ('pending', 'in_progress', 'completed', 'failed', 'rolled_back')", name="valid_fw_history_status"),
    )
