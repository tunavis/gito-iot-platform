"""Base SQLAlchemy models - enforces multi-tenancy on all tables."""

from sqlalchemy import (
    Column,
    String,
    DateTime,
    ForeignKey,
    CheckConstraint,
    Text,
    Integer,
    Float,
    Index,
    Boolean,
    SmallInteger,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import declarative_base

from app.services.secrets import EncryptedString
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
    tenant_metadata = Column(
        "metadata", JSONB, nullable=False, default={}
    )  # Added by migration 007 ('metadata' reserved in SA)
    # Added by migration 009 (tenant hierarchy)
    parent_tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    tenant_type = Column(
        String(50), nullable=False, default="client"
    )  # management | client | sub_client
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'inactive', 'suspended')", name="valid_tenant_status"
        ),
    )


class User(BaseModel):
    """User account - scoped to tenant."""

    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
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
            name="valid_user_role",
        ),
    )


class Device(BaseModel):
    """IoT Device - scoped to tenant with hierarchical organization."""

    __tablename__ = "devices"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Hierarchy: Organization → Site → Device Group → Device
    organization_id = Column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    site_id = Column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="SET NULL"), nullable=True, index=True
    )
    device_group_id = Column(
        UUID(as_uuid=True),
        ForeignKey("device_groups.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # The asset this device instruments, at most one. Deliberately a real column
    # and not an `attributes` key: rollups and asset device lists join and index on
    # it, unlike the GPS/vendor fields that live in the JSONB bag.
    # SET NULL, so deleting an asset detaches its instrumentation rather than
    # deleting devices or blocking the delete.
    asset_id = Column(
        UUID(as_uuid=True),
        ForeignKey("assets.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    name = Column(String(255), nullable=False)
    device_type = Column(String(100), nullable=False)
    device_type_id = Column(
        UUID(as_uuid=True),
        ForeignKey("device_types.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    description = Column(Text, nullable=True)
    serial_number = Column(String(255), nullable=True)
    tags = Column(JSONB, default=[], nullable=True)
    dev_eui = Column(String(16), nullable=True)  # For LoRaWAN
    status = Column(String(50), default="offline", nullable=False)
    last_seen = Column(DateTime(timezone=True))
    battery_level = Column(Float)
    signal_strength = Column(Integer)
    attributes = Column(JSONB, default={}, nullable=False)  # Device-specific attributes
    # The application namespace on whichever network server this device reports
    # from. Captured at ingest from the uplink; provider-agnostic. Renamed from
    # ttn_app_id in migration 032 — it never held a TTN id in this deployment.
    lorawan_app_id = Column(String(100), nullable=True)

    # The network server this device is reached through, for downlinks
    # (migration 031). NULL means the pre-binding resolution order, which is the
    # compatibility guarantee — but a device that DOES name an integration never
    # falls back to a global default, because dispatching to the wrong server
    # reports success. See app/services/network_server.py.
    integration_id = Column(
        UUID(as_uuid=True), ForeignKey("integrations.id", ondelete="SET NULL"), nullable=True
    )
    device_profile_id = Column(String(100), nullable=True)  # Device profile UUID
    ttn_synced = Column(
        Boolean, default=False, nullable=False
    )  # Whether device is synced to TTN server
    gateway_id = Column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_devices_status", "status"),
        Index("idx_devices_last_seen", "last_seen"),
        Index("idx_devices_tenant_dev_eui", "tenant_id", "dev_eui", unique=True),
        Index("idx_devices_organization", "organization_id"),
        Index("idx_devices_site", "site_id"),
        Index("idx_devices_group", "device_group_id"),
        Index("idx_devices_asset", "asset_id"),
        CheckConstraint(
            "status IN ('online', 'offline', 'idle', 'error', 'provisioning')",
            name="valid_device_status",
        ),
    )


class DeviceCredential(BaseModel):
    """Device authentication credentials - hashed and tenant-scoped."""

    __tablename__ = "device_credentials"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    device_id = Column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    )
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
            name="valid_cred_type",
        ),
    )


class DeviceCommand(BaseModel):
    """RPC command sent to a device — tracks full lifecycle (Option B: request-response correlation)."""

    __tablename__ = "device_commands"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    device_id = Column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    command_name = Column(String(100), nullable=False)
    parameters = Column(JSONB, default={})
    # 32, not 20: 'delivered_unconfirmed' is 21 characters (migration 029).
    status = Column(String(32), default="pending", nullable=False)
    response = Column(JSONB, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # The byte this command's device echoes when it answers (migration 030).
    # NULL when the device type declares no driver or no correlation — no
    # third-party device echoes `id`, and no first-party one needs an opcode.
    # A partial unique index on (device_id, opcode) over the in-flight statuses
    # is what makes "at most one in flight per pair" true rather than intended.
    opcode = Column(SmallInteger, nullable=True)

    # Approval gate (migrations 027, 028). All of these are NULL for commands
    # issued through the UI/REST path, which is never gated — a NULL
    # approved_by/rejected_by means "no decision was ever required", NOT
    # "undecided". Reading it as the latter would make every command ever sent
    # look like it is still waiting on someone.
    requested_by = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Why the agent asked. Deliberately not a key inside `parameters`, which is
    # the payload dispatched to the device.
    request_reason = Column(Text, nullable=True)
    approved_by = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_at = Column(DateTime(timezone=True), nullable=True)
    rejected_by = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    rejected_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("idx_device_commands_tenant", "tenant_id"),
        Index("idx_device_commands_device", "device_id"),
        Index("idx_device_commands_status", "status"),
        CheckConstraint(
            # 'delivered_unconfirmed' is terminal: the command reached the device
            # and its driver says this device can never acknowledge it. The sweep
            # only touches pending/sent/delivered, so it is excluded from expiry
            # by construction rather than by a second list to keep in step.
            "status IN ('pending', 'sent', 'delivered', 'executed', 'failed', "
            "'timed_out', 'awaiting_approval', 'rejected', 'delivered_unconfirmed')",
            name="valid_command_status",
        ),
    )


class AlertEvent(BaseModel):
    """Alarm events - Cumulocity-style alarms with severity levels and acknowledgment workflow."""

    __tablename__ = "alert_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    alert_rule_id = Column(
        UUID(as_uuid=True),
        ForeignKey("alert_rules.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    device_id = Column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    metric_name = Column(String(50), nullable=False)
    metric_value = Column(Float)
    message = Column(Text)

    # Alarm system fields
    severity = Column(
        String(20), default="MAJOR", nullable=False
    )  # CRITICAL, MAJOR, MINOR, WARNING
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
        CheckConstraint(
            "severity IN ('CRITICAL', 'MAJOR', 'MINOR', 'WARNING')", name="valid_severity"
        ),
        CheckConstraint(
            "status IN ('ACTIVE', 'ACKNOWLEDGED', 'CLEARED')", name="valid_alarm_status"
        ),
    )


class AuditLog(BaseModel):
    """User action audit trail - immutable log for compliance."""

    __tablename__ = "audit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    action = Column(String(100), nullable=False)  # create, update, delete, login, etc.
    resource_type = Column(String(100))  # device, user, alert, etc.
    resource_id = Column(UUID(as_uuid=True))
    changes = Column(JSONB)  # Before/after for updates
    ip_address = Column(String(45))
    user_agent = Column(Text)
    created_at = Column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False, index=True
    )

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

    tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    device_id = Column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    )

    # Key-value metric storage
    metric_key = Column(
        String(100), nullable=False
    )  # "temperature", "humidity", "custom_sensor_1", etc.
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
        Index(
            "idx_telemetry_latest", "device_id", "metric_key", "ts", postgresql_ops={"ts": "DESC"}
        ),
    )


# ---------------------------------------------------------------------------
# OTA Firmware Management
# ---------------------------------------------------------------------------


class FirmwareVersion(BaseModel):
    """Firmware binary metadata - one row per firmware release."""

    __tablename__ = "firmware_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name = Column(String(255), nullable=False)
    version = Column(String(50), nullable=False)  # semver: 1.2.3
    url = Column(String(2048), nullable=False)  # S3 / CDN URL
    size_bytes = Column(Integer, nullable=False)
    hash = Column(String(64), nullable=False)  # SHA-256
    release_type = Column(String(20), default="beta", nullable=False)  # beta|production|hotfix
    changelog = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_firmware_tenant", "tenant_id"),
        CheckConstraint(
            "release_type IN ('beta', 'production', 'hotfix')", name="valid_release_type"
        ),
    )


class OTACampaign(BaseModel):
    """Firmware update campaign - targets multiple devices."""

    __tablename__ = "ota_campaigns"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name = Column(String(255), nullable=False)
    firmware_version_id = Column(
        UUID(as_uuid=True), ForeignKey("firmware_versions.id", ondelete="RESTRICT"), nullable=False
    )
    rollout_strategy = Column(
        String(20), default="immediate", nullable=False
    )  # immediate|staggered|scheduled
    devices_per_hour = Column(Integer, default=100, nullable=False)
    auto_rollback_threshold = Column(Float, default=0.1, nullable=False)  # fraction 0-1
    status = Column(
        String(20), default="draft", nullable=False
    )  # draft|scheduled|in_progress|completed|failed|rolled_back
    scheduled_at = Column(DateTime(timezone=True), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_ota_campaigns_tenant", "tenant_id"),
        CheckConstraint(
            "rollout_strategy IN ('immediate', 'staggered', 'scheduled')",
            name="valid_rollout_strategy",
        ),
        CheckConstraint(
            "status IN ('draft', 'scheduled', 'in_progress', 'completed', 'failed', 'rolled_back')",
            name="valid_campaign_status",
        ),
    )


class OTACampaignDevice(BaseModel):
    """Per-device status within an OTA campaign."""

    __tablename__ = "ota_campaign_devices"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id = Column(
        UUID(as_uuid=True),
        ForeignKey("ota_campaigns.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    device_id = Column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    )
    status = Column(
        String(20), default="pending", nullable=False
    )  # pending|in_progress|completed|failed|skipped
    progress_percent = Column(Integer, default=0, nullable=False)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("idx_ota_campaign_devices_device", "device_id"),
        CheckConstraint(
            "status IN ('pending', 'in_progress', 'completed', 'failed', 'skipped')",
            name="valid_device_ota_status",
        ),
    )


class DeviceFirmwareHistory(BaseModel):
    """History of all firmware changes on a device."""

    __tablename__ = "device_firmware_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_id = Column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    firmware_version_id = Column(
        UUID(as_uuid=True), ForeignKey("firmware_versions.id", ondelete="SET NULL"), nullable=True
    )
    previous_version_id = Column(
        UUID(as_uuid=True), ForeignKey("firmware_versions.id", ondelete="SET NULL"), nullable=True
    )
    status = Column(
        String(20), default="pending", nullable=False
    )  # pending|in_progress|completed|failed|rolled_back
    progress_percent = Column(Integer, default=0, nullable=False)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'in_progress', 'completed', 'failed', 'rolled_back')",
            name="valid_fw_history_status",
        ),
    )


# ---------------------------------------------------------------------------
# LoRaWAN Integrations
# ---------------------------------------------------------------------------


class Integration(BaseModel):
    """Tenant integration for external LoRaWAN network server webhooks.

    Stores one row per integration (TTN, ChirpStack, Helium, Actility, custom).
    The raw integration key is never stored — only its SHA256 hash.
    """

    __tablename__ = "integrations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(100), nullable=False)
    provider = Column(String(50), nullable=False)
    key_hash = Column(
        String(64), nullable=True, unique=False
    )  # partial unique enforced by DB index
    key_prefix = Column(String(12), nullable=True)
    config = Column(JSONB, nullable=False, server_default="{}")

    # Downlink half of the same network server (migration 031). `config` holds
    # the MQTT endpoint uplinks arrive on; ChirpStack's queue API is a different
    # host and port, so one row now describes both directions — which is what
    # makes "add a network server" a single act.
    # Explicit, never inferred from how uplinks arrive — the two directions are
    # independent. 'none' is an answer (this server accepts no downlinks, so its
    # commands are refused at issue), distinct from NULL, which is an omission.
    downlink_mode = Column(String(20), nullable=True)
    # REST base URL. `mqtt` mode reuses the broker already in `config`.
    downlink_api_url = Column(Text, nullable=True)
    # A real column and not a `config` key, so the type can enforce encryption:
    # there is no write path that reaches this without encrypting. Unrelated to
    # `key_hash` above, which is a hash of an INBOUND key and cannot
    # authenticate an outbound call.
    downlink_api_key = Column(EncryptedString, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    message_count = Column(Integer, nullable=False, default=0)
    created_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    __table_args__ = (
        Index("idx_integrations_tenant", "tenant_id"),
        CheckConstraint(
            "provider IN ('chirpstack', 'ttn', 'helium', 'actility', 'custom', 'mqtt', 'http', 'chirpstack_mqtt')",
            name="valid_provider",
        ),
    )
