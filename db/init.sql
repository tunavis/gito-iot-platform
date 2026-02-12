-- ============================================================================
-- Gito IoT Platform - Database Schema
-- Generated from SQLAlchemy models (feature/telemetry-kv-refactor)
-- IDEMPOTENT: Safe to run on fresh or existing databases
-- ============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- SECTION 1: CORE ENTITIES
-- ============================================================================

-- Tenants (SaaS multi-tenancy root)
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT valid_tenant_status CHECK (status IN ('active', 'inactive', 'suspended'))
);

-- Users (tenant-scoped accounts)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    role VARCHAR(50) NOT NULL DEFAULT 'VIEWER',
    status VARCHAR(50) DEFAULT 'active',
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT valid_user_role CHECK (role IN ('SUPER_ADMIN', 'TENANT_ADMIN', 'SITE_ADMIN', 'CLIENT', 'VIEWER'))
);

-- Organizations (sub-customers within tenant)
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description TEXT,
    billing_contact VARCHAR(255),
    chirpstack_app_id VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    attributes JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT valid_org_status CHECK (status IN ('active', 'inactive', 'suspended'))
);

-- Sites (physical locations, hierarchical)
CREATE TABLE IF NOT EXISTS sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    parent_site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    site_type VARCHAR(50),
    address TEXT,
    coordinates JSONB,
    timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
    attributes JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Device Types (templates for device registration)
CREATE TABLE IF NOT EXISTS device_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    manufacturer VARCHAR(255),
    model VARCHAR(255),
    category VARCHAR(50) NOT NULL DEFAULT 'sensor',
    icon VARCHAR(50) DEFAULT 'cpu',
    color VARCHAR(20) DEFAULT '#6366f1',
    data_model JSONB DEFAULT '[]',
    capabilities JSONB DEFAULT '[]',
    default_settings JSONB DEFAULT '{}',
    connectivity JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT true,
    device_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Devices (IoT devices, tenant-scoped with hierarchy)
CREATE TABLE IF NOT EXISTS devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    device_group_id UUID,
    name VARCHAR(255) NOT NULL,
    device_type VARCHAR(100) NOT NULL,
    dev_eui VARCHAR(16),
    status VARCHAR(50) NOT NULL DEFAULT 'offline',
    last_seen TIMESTAMPTZ,
    battery_level FLOAT,
    signal_strength INTEGER,
    attributes JSONB NOT NULL DEFAULT '{}',
    ttn_app_id VARCHAR(100),
    device_profile_id VARCHAR(100),
    ttn_synced BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT valid_device_status CHECK (status IN ('online', 'offline', 'idle', 'error', 'provisioning'))
);

-- Device Groups (logical groupings of devices)
CREATE TABLE IF NOT EXISTS device_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    group_type VARCHAR(50),
    membership_rule JSONB NOT NULL DEFAULT '{}',
    attributes JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add FK for device_group_id after device_groups exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'devices_device_group_id_fkey'
    ) THEN
        ALTER TABLE devices ADD CONSTRAINT devices_device_group_id_fkey
            FOREIGN KEY (device_group_id) REFERENCES device_groups(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Group Devices (junction table)
CREATE TABLE IF NOT EXISTS group_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES device_groups(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_group_device UNIQUE(group_id, device_id)
);

-- Device Credentials
CREATE TABLE IF NOT EXISTS device_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    credential_type VARCHAR(50) NOT NULL,
    credential_hash VARCHAR(255) NOT NULL,
    username VARCHAR(255),
    status VARCHAR(50) DEFAULT 'active',
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    rotated_at TIMESTAMPTZ,
    CONSTRAINT valid_cred_type CHECK (credential_type IN ('mqtt_password', 'device_token', 'api_key'))
);

-- ============================================================================
-- SECTION 2: TELEMETRY (Key-Value Time-Series)
-- ============================================================================

CREATE TABLE IF NOT EXISTS telemetry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    metric_key VARCHAR(100) NOT NULL,
    metric_value FLOAT,
    metric_value_str VARCHAR(500),
    metric_value_json JSONB,
    unit VARCHAR(20),
    ts TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- SECTION 3: ALERT SYSTEM (Unified: THRESHOLD + COMPOSITE)
-- ============================================================================

CREATE TABLE IF NOT EXISTS alert_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255),
    description TEXT,
    rule_type VARCHAR(20) NOT NULL DEFAULT 'THRESHOLD',
    severity VARCHAR(20) NOT NULL DEFAULT 'MAJOR',
    active BOOLEAN NOT NULL DEFAULT true,
    cooldown_minutes INTEGER NOT NULL DEFAULT 5,
    last_fired_at TIMESTAMPTZ,
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
    metric VARCHAR(50),
    operator VARCHAR(10),
    threshold FLOAT,
    conditions JSONB,
    logic VARCHAR(10),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alert_rule_conditions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    field VARCHAR(100) NOT NULL,
    operator VARCHAR(10) NOT NULL,
    threshold FLOAT NOT NULL,
    weight INTEGER NOT NULL DEFAULT 1,
    sequence INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT valid_condition_operator CHECK (operator IN ('>', '<', '>=', '<=', '==', '!=')),
    CONSTRAINT valid_condition_weight CHECK (weight >= 1 AND weight <= 100)
);

CREATE TABLE IF NOT EXISTS alert_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alert_rule_id UUID REFERENCES alert_rules(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    metric_name VARCHAR(50) NOT NULL,
    metric_value FLOAT,
    message TEXT,
    severity VARCHAR(20) NOT NULL DEFAULT 'MAJOR',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    alarm_type VARCHAR(100),
    source VARCHAR(100),
    acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
    acknowledged_at TIMESTAMPTZ,
    cleared_at TIMESTAMPTZ,
    notification_sent BOOLEAN NOT NULL DEFAULT false,
    notification_sent_at TIMESTAMPTZ,
    fired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT valid_severity CHECK (severity IN ('CRITICAL', 'MAJOR', 'MINOR', 'WARNING')),
    CONSTRAINT valid_alarm_status CHECK (status IN ('ACTIVE', 'ACKNOWLEDGED', 'CLEARED'))
);

CREATE TABLE IF NOT EXISTS alarms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alert_rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
    acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
    alarm_type VARCHAR(100) NOT NULL,
    source VARCHAR(255),
    severity VARCHAR(20) NOT NULL DEFAULT 'MAJOR',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    message TEXT NOT NULL,
    context JSONB,
    fired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at TIMESTAMPTZ,
    cleared_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT valid_alarm_severity CHECK (severity IN ('CRITICAL', 'MAJOR', 'MINOR', 'WARNING')),
    CONSTRAINT valid_alarm_lifecycle CHECK (status IN ('ACTIVE', 'ACKNOWLEDGED', 'CLEARED'))
);

CREATE TABLE IF NOT EXISTS composite_alert_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    enabled BOOLEAN NOT NULL DEFAULT true,
    conditions JSONB NOT NULL DEFAULT '[]',
    logic VARCHAR(10) NOT NULL DEFAULT 'AND',
    severity VARCHAR(20) NOT NULL DEFAULT 'warning',
    weight_score INTEGER,
    cooldown_minutes INTEGER DEFAULT 5,
    last_triggered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT valid_logic CHECK (logic IN ('AND', 'OR')),
    CONSTRAINT valid_composite_severity CHECK (severity IN ('info', 'warning', 'critical'))
);

-- ============================================================================
-- SECTION 4: AUDIT & LOGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100),
    resource_id UUID,
    changes JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- SECTION 5: NOTIFICATIONS (Redesigned)
-- ============================================================================

CREATE TABLE IF NOT EXISTS notification_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel_type VARCHAR(50) NOT NULL,
    alert_type VARCHAR(100),
    name VARCHAR(255) NOT NULL,
    subject VARCHAR(500),
    body TEXT NOT NULL,
    variables JSONB NOT NULL DEFAULT '{}',
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT valid_template_channel_type CHECK (channel_type IN ('email', 'slack', 'webhook'))
);

CREATE TABLE IF NOT EXISTS notification_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_type VARCHAR(50) NOT NULL,
    config JSONB NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    verified BOOLEAN NOT NULL DEFAULT false,
    verified_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT valid_notification_channel_type CHECK (channel_type IN ('email', 'slack', 'webhook', 'apns', 'fcm', 'sms'))
);

CREATE TABLE IF NOT EXISTS notification_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alert_rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alert_event_id UUID NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
    channel_type VARCHAR(50) NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    delivery_status VARCHAR(50),
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT valid_notification_status CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'bounced', 'skipped')),
    CONSTRAINT valid_delivery_status CHECK (delivery_status IS NULL OR delivery_status IN ('success', 'permanent_failure', 'temporary_failure', 'invalid_address', 'rate_limited'))
);

CREATE TABLE IF NOT EXISTS notification_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alert_event_id UUID NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    error_message TEXT,
    attempted_at TIMESTAMPTZ,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT valid_notification_queue_status CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

-- ============================================================================
-- SECTION 6: FIRMWARE & OTA (retained from staging)
-- ============================================================================

CREATE TABLE IF NOT EXISTS firmware_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    version VARCHAR(50) NOT NULL,
    url VARCHAR(2048) NOT NULL,
    size_bytes INTEGER NOT NULL,
    hash VARCHAR(64) NOT NULL,
    release_type VARCHAR(20) DEFAULT 'beta',
    changelog TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_version_per_tenant UNIQUE(tenant_id, version)
);

CREATE TABLE IF NOT EXISTS device_firmware_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    firmware_version_id UUID REFERENCES firmware_versions(id) ON DELETE SET NULL,
    previous_version_id UUID REFERENCES firmware_versions(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL,
    progress_percent INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ota_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    firmware_version_id UUID NOT NULL REFERENCES firmware_versions(id) ON DELETE RESTRICT,
    status VARCHAR(50) DEFAULT 'draft',
    scheduled_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    rollout_strategy VARCHAR(50) DEFAULT 'immediate',
    devices_per_hour INTEGER DEFAULT 100,
    auto_rollback_threshold FLOAT DEFAULT 0.1,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ota_campaign_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES ota_campaigns(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'pending',
    progress_percent INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    CONSTRAINT unique_campaign_device UNIQUE(campaign_id, device_id)
);

CREATE TABLE IF NOT EXISTS group_bulk_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES device_groups(id) ON DELETE CASCADE,
    operation_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'queued',
    cadence_workflow_id VARCHAR(255),
    devices_total INTEGER NOT NULL,
    devices_completed INTEGER NOT NULL DEFAULT 0,
    devices_failed INTEGER NOT NULL DEFAULT 0,
    progress_percent INTEGER NOT NULL DEFAULT 0,
    operation_metadata JSONB NOT NULL DEFAULT '{}',
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT valid_bulk_op_type CHECK (operation_type IN ('bulk_ota', 'bulk_command', 'bulk_sync')),
    CONSTRAINT valid_bulk_op_status CHECK (status IN ('queued', 'running', 'completed', 'failed'))
);

-- ============================================================================
-- SECTION 7: DASHBOARDS & WIDGETS
-- ============================================================================

CREATE TABLE IF NOT EXISTS dashboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    is_default BOOLEAN NOT NULL DEFAULT false,
    layout_config JSONB NOT NULL DEFAULT '{}',
    theme JSONB NOT NULL DEFAULT '{}',
    solution_type VARCHAR(100),
    extra_data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dashboard_widgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    widget_type VARCHAR(50) NOT NULL,
    title VARCHAR(200),
    position_x INTEGER NOT NULL,
    position_y INTEGER NOT NULL,
    width INTEGER NOT NULL DEFAULT 2,
    height INTEGER NOT NULL DEFAULT 2,
    configuration JSONB NOT NULL DEFAULT '{}',
    data_sources JSONB NOT NULL DEFAULT '[]',
    refresh_interval INTEGER NOT NULL DEFAULT 30,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT check_positive_dimensions CHECK (width > 0 AND height > 0),
    CONSTRAINT check_valid_position CHECK (position_x >= 0 AND position_y >= 0)
);

CREATE TABLE IF NOT EXISTS solution_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL UNIQUE,
    identifier VARCHAR(100) NOT NULL UNIQUE,
    category VARCHAR(50) NOT NULL,
    description TEXT,
    icon VARCHAR(50) DEFAULT 'layout-dashboard',
    color VARCHAR(20) DEFAULT '#0066CC',
    target_device_types JSONB NOT NULL DEFAULT '[]',
    required_capabilities JSONB NOT NULL DEFAULT '[]',
    template_config JSONB NOT NULL,
    preview_image_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- SECTION 8: INDEXES
-- ============================================================================

DO $$
BEGIN
    -- Tenants
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_tenants_slug') THEN
        CREATE INDEX idx_tenants_slug ON tenants(slug);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_tenants_status') THEN
        CREATE INDEX idx_tenants_status ON tenants(status);
    END IF;

    -- Users
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_users_tenant_id') THEN
        CREATE INDEX idx_users_tenant_id ON users(tenant_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_users_tenant_email') THEN
        CREATE UNIQUE INDEX idx_users_tenant_email ON users(tenant_id, email);
    END IF;

    -- Organizations
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_organizations_tenant') THEN
        CREATE INDEX idx_organizations_tenant ON organizations(tenant_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_organizations_slug') THEN
        CREATE UNIQUE INDEX idx_organizations_slug ON organizations(tenant_id, slug);
    END IF;

    -- Sites
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sites_tenant') THEN
        CREATE INDEX idx_sites_tenant ON sites(tenant_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sites_organization') THEN
        CREATE INDEX idx_sites_organization ON sites(organization_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sites_parent') THEN
        CREATE INDEX idx_sites_parent ON sites(parent_site_id);
    END IF;

    -- Device Types
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_device_types_tenant') THEN
        CREATE INDEX idx_device_types_tenant ON device_types(tenant_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_device_types_category') THEN
        CREATE INDEX idx_device_types_category ON device_types(category);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_device_types_active') THEN
        CREATE INDEX idx_device_types_active ON device_types(is_active);
    END IF;

    -- Devices
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_devices_tenant_id') THEN
        CREATE INDEX idx_devices_tenant_id ON devices(tenant_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_devices_status') THEN
        CREATE INDEX idx_devices_status ON devices(status);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_devices_last_seen') THEN
        CREATE INDEX idx_devices_last_seen ON devices(last_seen);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_devices_tenant_dev_eui') THEN
        CREATE UNIQUE INDEX idx_devices_tenant_dev_eui ON devices(tenant_id, dev_eui);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_devices_organization') THEN
        CREATE INDEX idx_devices_organization ON devices(organization_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_devices_site') THEN
        CREATE INDEX idx_devices_site ON devices(site_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_devices_group') THEN
        CREATE INDEX idx_devices_group ON devices(device_group_id);
    END IF;

    -- Device Groups
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_device_groups_tenant') THEN
        CREATE INDEX idx_device_groups_tenant ON device_groups(tenant_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_device_groups_org') THEN
        CREATE INDEX idx_device_groups_org ON device_groups(organization_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_device_groups_site') THEN
        CREATE INDEX idx_device_groups_site ON device_groups(site_id);
    END IF;

    -- Device Credentials
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_creds_tenant_device') THEN
        CREATE INDEX idx_creds_tenant_device ON device_credentials(tenant_id, device_id);
    END IF;

    -- Telemetry (KV pattern)
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_telemetry_device_metric_ts') THEN
        CREATE INDEX idx_telemetry_device_metric_ts ON telemetry(device_id, metric_key, ts);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_telemetry_tenant_device') THEN
        CREATE INDEX idx_telemetry_tenant_device ON telemetry(tenant_id, device_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_telemetry_ts') THEN
        CREATE INDEX idx_telemetry_ts ON telemetry(ts);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_telemetry_latest') THEN
        CREATE INDEX idx_telemetry_latest ON telemetry(device_id, metric_key, ts DESC);
    END IF;

    -- Alert Rules
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alert_rules_tenant') THEN
        CREATE INDEX idx_alert_rules_tenant ON alert_rules(tenant_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alert_rules_device') THEN
        CREATE INDEX idx_alert_rules_device ON alert_rules(device_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alert_rules_active') THEN
        CREATE INDEX idx_alert_rules_active ON alert_rules(active);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alert_rules_type') THEN
        CREATE INDEX idx_alert_rules_type ON alert_rules(rule_type);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alert_rules_severity') THEN
        CREATE INDEX idx_alert_rules_severity ON alert_rules(severity);
    END IF;

    -- Alert Rule Conditions
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alert_conditions_rule') THEN
        CREATE INDEX idx_alert_conditions_rule ON alert_rule_conditions(rule_id);
    END IF;

    -- Alert Events
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alert_events_tenant') THEN
        CREATE INDEX idx_alert_events_tenant ON alert_events(tenant_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alert_events_rule') THEN
        CREATE INDEX idx_alert_events_rule ON alert_events(alert_rule_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alert_events_device') THEN
        CREATE INDEX idx_alert_events_device ON alert_events(device_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alert_events_severity') THEN
        CREATE INDEX idx_alert_events_severity ON alert_events(severity);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alert_events_status') THEN
        CREATE INDEX idx_alert_events_status ON alert_events(status);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alert_events_fired') THEN
        CREATE INDEX idx_alert_events_fired ON alert_events(fired_at);
    END IF;

    -- Alarms
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alarms_tenant') THEN
        CREATE INDEX idx_alarms_tenant ON alarms(tenant_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alarms_device') THEN
        CREATE INDEX idx_alarms_device ON alarms(device_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alarms_type') THEN
        CREATE INDEX idx_alarms_type ON alarms(alarm_type);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alarms_severity') THEN
        CREATE INDEX idx_alarms_severity ON alarms(severity);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alarms_status') THEN
        CREATE INDEX idx_alarms_status ON alarms(status);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alarms_fired') THEN
        CREATE INDEX idx_alarms_fired ON alarms(fired_at);
    END IF;

    -- Composite Alert Rules
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_composite_rules_tenant') THEN
        CREATE INDEX idx_composite_rules_tenant ON composite_alert_rules(tenant_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_composite_rules_enabled') THEN
        CREATE INDEX idx_composite_rules_enabled ON composite_alert_rules(enabled);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_composite_rules_severity') THEN
        CREATE INDEX idx_composite_rules_severity ON composite_alert_rules(severity);
    END IF;

    -- Dashboards
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_dashboards_tenant_user') THEN
        CREATE INDEX idx_dashboards_tenant_user ON dashboards(tenant_id, user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_dashboards_solution_type') THEN
        CREATE INDEX idx_dashboards_solution_type ON dashboards(solution_type);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_dashboards_created_at') THEN
        CREATE INDEX idx_dashboards_created_at ON dashboards(created_at);
    END IF;

    -- Dashboard Widgets
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_widgets_dashboard') THEN
        CREATE INDEX idx_widgets_dashboard ON dashboard_widgets(dashboard_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_dashboard_widgets_type') THEN
        CREATE INDEX idx_dashboard_widgets_type ON dashboard_widgets(widget_type);
    END IF;

    -- Solution Templates
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_solution_templates_category') THEN
        CREATE INDEX idx_solution_templates_category ON solution_templates(category);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_solution_templates_active') THEN
        CREATE INDEX idx_solution_templates_active ON solution_templates(is_active);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_solution_templates_identifier') THEN
        CREATE INDEX idx_solution_templates_identifier ON solution_templates(identifier);
    END IF;

    -- Notification Templates
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notification_templates_tenant') THEN
        CREATE INDEX idx_notification_templates_tenant ON notification_templates(tenant_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notification_templates_channel') THEN
        CREATE INDEX idx_notification_templates_channel ON notification_templates(channel_type);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notification_templates_enabled') THEN
        CREATE INDEX idx_notification_templates_enabled ON notification_templates(enabled);
    END IF;

    -- Notification Channels
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notification_channels_tenant') THEN
        CREATE INDEX idx_notification_channels_tenant ON notification_channels(tenant_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notification_channels_user') THEN
        CREATE INDEX idx_notification_channels_user ON notification_channels(user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notification_channels_enabled') THEN
        CREATE INDEX idx_notification_channels_enabled ON notification_channels(enabled);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notification_channels_type') THEN
        CREATE INDEX idx_notification_channels_type ON notification_channels(channel_type);
    END IF;

    -- Notification Rules
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notification_rules_alert') THEN
        CREATE INDEX idx_notification_rules_alert ON notification_rules(alert_rule_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notification_rules_channel') THEN
        CREATE INDEX idx_notification_rules_channel ON notification_rules(channel_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notification_rules_enabled') THEN
        CREATE INDEX idx_notification_rules_enabled ON notification_rules(enabled);
    END IF;

    -- Notifications
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notifications_tenant') THEN
        CREATE INDEX idx_notifications_tenant ON notifications(tenant_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notifications_alert_event') THEN
        CREATE INDEX idx_notifications_alert_event ON notifications(alert_event_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notifications_channel') THEN
        CREATE INDEX idx_notifications_channel ON notifications(channel_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notifications_status') THEN
        CREATE INDEX idx_notifications_status ON notifications(status);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notifications_recipient') THEN
        CREATE INDEX idx_notifications_recipient ON notifications(recipient);
    END IF;

    -- Notification Queue
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notification_queue_status') THEN
        CREATE INDEX idx_notification_queue_status ON notification_queue(status);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notification_queue_tenant') THEN
        CREATE INDEX idx_notification_queue_tenant ON notification_queue(tenant_id);
    END IF;

    -- Audit Logs
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_audit_tenant') THEN
        CREATE INDEX idx_audit_tenant ON audit_logs(tenant_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_audit_user') THEN
        CREATE INDEX idx_audit_user ON audit_logs(user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_audit_resource') THEN
        CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_audit_created_at') THEN
        CREATE INDEX idx_audit_created_at ON audit_logs(created_at DESC);
    END IF;

    -- Bulk Operations
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_bulk_operations_tenant') THEN
        CREATE INDEX idx_bulk_operations_tenant ON group_bulk_operations(tenant_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_bulk_operations_group') THEN
        CREATE INDEX idx_bulk_operations_group ON group_bulk_operations(group_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_bulk_operations_status') THEN
        CREATE INDEX idx_bulk_operations_status ON group_bulk_operations(status);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_bulk_operations_created_at') THEN
        CREATE INDEX idx_bulk_operations_created_at ON group_bulk_operations(created_at);
    END IF;
END $$;

-- ============================================================================
-- SECTION 9: ROW-LEVEL SECURITY
-- ============================================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE alarms ENABLE ROW LEVEL SECURITY;
ALTER TABLE composite_alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE firmware_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_firmware_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_bulk_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboards ENABLE ROW LEVEL SECURITY;

-- RLS Policies (idempotent)
DO $$
BEGIN
    -- Users
    DROP POLICY IF EXISTS users_tenant_isolation ON users;
    CREATE POLICY users_tenant_isolation ON users FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- Organizations
    DROP POLICY IF EXISTS organizations_tenant_isolation ON organizations;
    CREATE POLICY organizations_tenant_isolation ON organizations FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- Sites
    DROP POLICY IF EXISTS sites_tenant_isolation ON sites;
    CREATE POLICY sites_tenant_isolation ON sites FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- Devices
    DROP POLICY IF EXISTS devices_tenant_isolation ON devices;
    CREATE POLICY devices_tenant_isolation ON devices FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- Device Types
    DROP POLICY IF EXISTS device_types_tenant_isolation ON device_types;
    CREATE POLICY device_types_tenant_isolation ON device_types FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- Device Groups
    DROP POLICY IF EXISTS device_groups_tenant_isolation ON device_groups;
    CREATE POLICY device_groups_tenant_isolation ON device_groups FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- Device Credentials
    DROP POLICY IF EXISTS creds_tenant_isolation ON device_credentials;
    CREATE POLICY creds_tenant_isolation ON device_credentials FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- Telemetry
    DROP POLICY IF EXISTS telemetry_tenant_isolation ON telemetry;
    CREATE POLICY telemetry_tenant_isolation ON telemetry FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- Alert Rules
    DROP POLICY IF EXISTS alert_rules_tenant_isolation ON alert_rules;
    CREATE POLICY alert_rules_tenant_isolation ON alert_rules FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- Alert Events
    DROP POLICY IF EXISTS alert_events_tenant_isolation ON alert_events;
    CREATE POLICY alert_events_tenant_isolation ON alert_events FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- Alarms
    DROP POLICY IF EXISTS alarms_tenant_isolation ON alarms;
    CREATE POLICY alarms_tenant_isolation ON alarms FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- Composite Alert Rules
    DROP POLICY IF EXISTS composite_rules_tenant_isolation ON composite_alert_rules;
    CREATE POLICY composite_rules_tenant_isolation ON composite_alert_rules FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- Audit Logs
    DROP POLICY IF EXISTS audit_tenant_isolation ON audit_logs;
    CREATE POLICY audit_tenant_isolation ON audit_logs FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- Notification Channels
    DROP POLICY IF EXISTS channels_tenant_isolation ON notification_channels;
    CREATE POLICY channels_tenant_isolation ON notification_channels FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- Notification Rules
    DROP POLICY IF EXISTS rules_tenant_isolation ON notification_rules;
    CREATE POLICY rules_tenant_isolation ON notification_rules FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- Notifications
    DROP POLICY IF EXISTS notifications_tenant_isolation ON notifications;
    CREATE POLICY notifications_tenant_isolation ON notifications FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- Notification Queue
    DROP POLICY IF EXISTS queue_tenant_isolation ON notification_queue;
    CREATE POLICY queue_tenant_isolation ON notification_queue FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- Notification Templates
    DROP POLICY IF EXISTS templates_tenant_isolation ON notification_templates;
    CREATE POLICY templates_tenant_isolation ON notification_templates FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- Firmware Versions
    DROP POLICY IF EXISTS firmware_tenant_isolation ON firmware_versions;
    CREATE POLICY firmware_tenant_isolation ON firmware_versions FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- Device Firmware History
    DROP POLICY IF EXISTS firmware_history_tenant_isolation ON device_firmware_history;
    CREATE POLICY firmware_history_tenant_isolation ON device_firmware_history FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- OTA Campaigns
    DROP POLICY IF EXISTS campaigns_tenant_isolation ON ota_campaigns;
    CREATE POLICY campaigns_tenant_isolation ON ota_campaigns FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- Bulk Operations
    DROP POLICY IF EXISTS bulk_ops_tenant_isolation ON group_bulk_operations;
    CREATE POLICY bulk_ops_tenant_isolation ON group_bulk_operations FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- Dashboards (user-scoped)
    DROP POLICY IF EXISTS dashboards_user_isolation ON dashboards;
    CREATE POLICY dashboards_user_isolation ON dashboards FOR ALL
        USING (
            tenant_id = current_setting('app.current_tenant_id', true)::UUID
            AND user_id = current_setting('app.current_user_id', true)::UUID
        );
END $$;

-- ============================================================================
-- SECTION 10: FUNCTIONS & TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    tbl TEXT;
    tables_with_updated_at TEXT[] := ARRAY[
        'tenants', 'users', 'organizations', 'sites', 'devices', 'device_types',
        'device_groups', 'alert_rules', 'alarms', 'composite_alert_rules',
        'notification_channels', 'notification_rules', 'notification_templates',
        'firmware_versions', 'ota_campaigns',
        'group_bulk_operations', 'dashboards', 'dashboard_widgets',
        'solution_templates', 'notifications'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables_with_updated_at
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I_update_trigger ON %I', tbl, tbl);
        EXECUTE format('CREATE TRIGGER %I_update_trigger BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', tbl, tbl);
    END LOOP;
END $$;

-- ============================================================================
-- SECTION 11: SEED DATA (Demo Tenant & Admin)
-- ============================================================================

INSERT INTO tenants (id, name, slug, status)
VALUES (
    '00000000-0000-0000-0000-000000000001'::UUID,
    'Demo Tenant',
    'demo',
    'active'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO users (
    id, tenant_id, email, password_hash, full_name, role, status
) VALUES (
    '00000000-0000-0000-0000-000000000010'::UUID,
    '00000000-0000-0000-0000-000000000001'::UUID,
    'admin@gito.demo',
    '$2b$12$3XqrhD4oIt2k3vkxdiJv1u6w46v.dRNWKlUBdEihb6nQSII1HAcTC',
    'Admin User',
    'TENANT_ADMIN',
    'active'
) ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- COMPLETE
-- ============================================================================
-- This schema matches the SQLAlchemy models on feature/telemetry-kv-refactor.
-- Safe to run on a fresh database. Staging DB must be reset (volume removed).
-- ============================================================================
