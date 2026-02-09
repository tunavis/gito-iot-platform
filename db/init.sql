-- ============================================================================
-- GITO IOT PLATFORM - PostgreSQL Schema (Production-Ready, Idempotent)
-- ============================================================================
-- This file is 100% IDEMPOTENT - safe to run multiple times on any database
-- All CREATE TABLE use IF NOT EXISTS
-- All CREATE INDEX use IF NOT EXISTS
-- All ALTER TABLE check before adding columns
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- SECTION 1: CORE TABLES
-- ============================================================================

-- Tenants (SaaS Customers - root of multi-tenancy)
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Users (User Accounts)
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
    CONSTRAINT unique_email_per_tenant UNIQUE(tenant_id, email),
    CONSTRAINT valid_role CHECK (role IN ('SUPER_ADMIN', 'TENANT_ADMIN', 'SITE_ADMIN', 'CLIENT', 'VIEWER'))
);

-- Organizations (Sub-customers within tenants)
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    parent_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    attributes JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_org_name_per_tenant UNIQUE(tenant_id, name)
);

-- Sites (Physical locations)
CREATE TABLE IF NOT EXISTS sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50),
    address TEXT,
    coordinates JSONB,
    timezone VARCHAR(50) DEFAULT 'UTC',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_site_name_per_org UNIQUE(tenant_id, organization_id, name)
);

-- Device Types (Templates with telemetry schemas)
CREATE TABLE IF NOT EXISTS device_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    manufacturer VARCHAR(255),
    model VARCHAR(255),
    category VARCHAR(100),
    icon VARCHAR(50),
    color VARCHAR(20),
    data_model JSONB DEFAULT '[]',
    telemetry_schema JSONB DEFAULT '{}',
    command_schema JSONB DEFAULT '{}',
    capabilities JSONB DEFAULT '[]',
    default_settings JSONB DEFAULT '{}',
    connectivity JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_device_type_name UNIQUE(tenant_id, name)
);

-- Devices (IoT Device Inventory)
CREATE TABLE IF NOT EXISTS devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    device_group_id UUID,
    device_type_id UUID REFERENCES device_types(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    device_type VARCHAR(100),
    dev_eui VARCHAR(16),
    app_eui VARCHAR(16),
    app_key VARCHAR(32),
    join_eui VARCHAR(16),
    ttn_app_id VARCHAR(100),
    ttn_dev_id VARCHAR(100),
    chirpstack_app_id VARCHAR(100),
    device_profile_id VARCHAR(100),
    chirpstack_synced BOOLEAN DEFAULT FALSE,
    status VARCHAR(50) DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'idle', 'error', 'provisioning')),
    last_seen TIMESTAMPTZ,
    battery_level FLOAT,
    signal_strength INTEGER,
    attributes JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Device Groups (Logical groupings of devices)
CREATE TABLE IF NOT EXISTS device_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    membership_rule JSONB DEFAULT '{}',
    attributes JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_group_name_per_tenant UNIQUE(tenant_id, name)
);

-- Add foreign key for device_group_id after device_groups exists
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

-- Group Devices (Junction table)
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
    credential_type VARCHAR(50) NOT NULL CHECK (credential_type IN ('mqtt_password', 'device_token', 'api_key')),
    credential_hash VARCHAR(255) NOT NULL,
    username VARCHAR(255),
    status VARCHAR(50) DEFAULT 'active',
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    rotated_at TIMESTAMPTZ
);

-- ============================================================================
-- SECTION 2: TELEMETRY & TIME-SERIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS telemetry_hot (
    id UUID DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    temperature FLOAT,
    humidity FLOAT,
    pressure FLOAT,
    battery FLOAT,
    rssi INTEGER,
    payload JSONB,
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- SECTION 3: ALERT SYSTEM
-- ============================================================================

CREATE TABLE IF NOT EXISTS alert_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
    name VARCHAR(255),
    description TEXT,
    metric VARCHAR(100),
    operator VARCHAR(10) CHECK (operator IN ('>', '<', '>=', '<=', '==', '!=')),
    threshold FLOAT,
    severity VARCHAR(20) DEFAULT 'warning',
    cooldown_minutes INTEGER DEFAULT 5,
    active BOOLEAN DEFAULT true,
    last_fired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alert_rule_conditions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    field VARCHAR(100) NOT NULL,
    operator VARCHAR(10) NOT NULL,
    threshold FLOAT NOT NULL,
    weight INTEGER DEFAULT 1,
    sequence INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alert_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alert_rule_id UUID REFERENCES alert_rules(id) ON DELETE CASCADE,
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
    metric_name VARCHAR(50),
    metric_value FLOAT,
    message TEXT,
    notification_sent BOOLEAN DEFAULT false,
    notification_sent_at TIMESTAMPTZ,
    fired_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alarms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
    alert_rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'warning',
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'cleared', 'suppressed')),
    message TEXT,
    metadata JSONB DEFAULT '{}',
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID REFERENCES users(id),
    cleared_at TIMESTAMPTZ,
    cleared_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS composite_alert_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    logic_operator VARCHAR(10) DEFAULT 'AND' CHECK (logic_operator IN ('AND', 'OR')),
    conditions JSONB NOT NULL DEFAULT '[]',
    actions JSONB DEFAULT '[]',
    enabled BOOLEAN DEFAULT true,
    cooldown_minutes INTEGER DEFAULT 5,
    last_triggered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
-- SECTION 5: NOTIFICATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS notification_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    subject_template TEXT,
    body_template TEXT NOT NULL,
    variables JSONB DEFAULT '[]',
    is_system BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    config JSONB NOT NULL DEFAULT '{}',
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    event_types JSONB NOT NULL DEFAULT '[]',
    channel_ids JSONB NOT NULL DEFAULT '[]',
    template_id UUID REFERENCES notification_templates(id),
    conditions JSONB DEFAULT '{}',
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    channel_id UUID REFERENCES notification_channels(id),
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255),
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'pending',
    sent_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel_id UUID REFERENCES notification_channels(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    scheduled_for TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_type VARCHAR(50) NOT NULL,
    enabled BOOLEAN DEFAULT true,
    config JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_user_channel UNIQUE(user_id, channel_type)
);

-- ============================================================================
-- SECTION 6: FIRMWARE & OTA
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
    operation_type VARCHAR(50) NOT NULL CHECK (operation_type IN ('bulk_ota', 'bulk_command', 'bulk_sync')),
    status VARCHAR(50) DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    cadence_workflow_id VARCHAR(255),
    devices_total INTEGER NOT NULL,
    devices_completed INTEGER DEFAULT 0,
    devices_failed INTEGER DEFAULT 0,
    progress_percent INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- SECTION 7: DASHBOARDS & WIDGETS
-- ============================================================================

CREATE TABLE IF NOT EXISTS dashboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_default BOOLEAN DEFAULT false,
    layout JSONB DEFAULT '[]',
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dashboard_widgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    widget_type VARCHAR(50) NOT NULL,
    title VARCHAR(255),
    configuration JSONB DEFAULT '{}',
    data_sources JSONB DEFAULT '[]',
    position_x INTEGER DEFAULT 0,
    position_y INTEGER DEFAULT 0,
    width INTEGER DEFAULT 4,
    height INTEGER DEFAULT 3,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS solution_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    industry VARCHAR(100),
    category VARCHAR(100),
    icon VARCHAR(50),
    preview_image VARCHAR(500),
    dashboard_template JSONB NOT NULL DEFAULT '{}',
    device_type_templates JSONB DEFAULT '[]',
    alert_rule_templates JSONB DEFAULT '[]',
    tags JSONB DEFAULT '[]',
    is_featured BOOLEAN DEFAULT false,
    usage_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- SECTION 8: DEVICE EVENTS & PROFILES
-- ============================================================================

CREATE TABLE IF NOT EXISTS event_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    severity VARCHAR(20) DEFAULT 'info',
    category VARCHAR(50),
    is_system BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_event_code_per_tenant UNIQUE(tenant_id, code)
);

CREATE TABLE IF NOT EXISTS device_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    event_type_id UUID REFERENCES event_types(id) ON DELETE SET NULL,
    event_code VARCHAR(50) NOT NULL,
    severity VARCHAR(20) DEFAULT 'info',
    message TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_availability_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL,
    previous_status VARCHAR(20),
    reason VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    protocol VARCHAR(50) NOT NULL,
    payload_codec JSONB DEFAULT '{}',
    uplink_decoder TEXT,
    downlink_encoder TEXT,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_profile_name UNIQUE(tenant_id, name)
);

-- ============================================================================
-- SECTION 9: INDEXES (All with IF NOT EXISTS via DO blocks)
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
        CREATE INDEX idx_users_tenant_email ON users(tenant_id, email);
    END IF;

    -- Organizations
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_organizations_tenant') THEN
        CREATE INDEX idx_organizations_tenant ON organizations(tenant_id);
    END IF;

    -- Sites
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sites_tenant') THEN
        CREATE INDEX idx_sites_tenant ON sites(tenant_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sites_organization') THEN
        CREATE INDEX idx_sites_organization ON sites(organization_id);
    END IF;

    -- Devices
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_devices_tenant_id') THEN
        CREATE INDEX idx_devices_tenant_id ON devices(tenant_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_devices_status') THEN
        CREATE INDEX idx_devices_status ON devices(status);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_devices_last_seen') THEN
        CREATE INDEX idx_devices_last_seen ON devices(last_seen DESC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_devices_organization') THEN
        CREATE INDEX idx_devices_organization ON devices(organization_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_devices_site') THEN
        CREATE INDEX idx_devices_site ON devices(site_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_devices_device_type') THEN
        CREATE INDEX idx_devices_device_type ON devices(device_type_id);
    END IF;

    -- Device Types
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_device_types_tenant') THEN
        CREATE INDEX idx_device_types_tenant ON device_types(tenant_id);
    END IF;

    -- Device Groups
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_device_groups_tenant') THEN
        CREATE INDEX idx_device_groups_tenant ON device_groups(tenant_id);
    END IF;

    -- Telemetry
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_telemetry_tenant_device') THEN
        CREATE INDEX idx_telemetry_tenant_device ON telemetry_hot(tenant_id, device_id, timestamp DESC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_telemetry_device_time') THEN
        CREATE INDEX idx_telemetry_device_time ON telemetry_hot(device_id, timestamp DESC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_telemetry_timestamp') THEN
        CREATE INDEX idx_telemetry_timestamp ON telemetry_hot(timestamp DESC);
    END IF;

    -- Alert Rules
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alert_rules_tenant') THEN
        CREATE INDEX idx_alert_rules_tenant ON alert_rules(tenant_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alert_rules_device') THEN
        CREATE INDEX idx_alert_rules_device ON alert_rules(device_id);
    END IF;

    -- Alarms
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alarms_tenant') THEN
        CREATE INDEX idx_alarms_tenant ON alarms(tenant_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alarms_device') THEN
        CREATE INDEX idx_alarms_device ON alarms(device_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alarms_status') THEN
        CREATE INDEX idx_alarms_status ON alarms(status);
    END IF;

    -- Dashboards
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_dashboards_tenant_user') THEN
        CREATE INDEX idx_dashboards_tenant_user ON dashboards(tenant_id, user_id);
    END IF;

    -- Dashboard Widgets
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_widgets_dashboard') THEN
        CREATE INDEX idx_widgets_dashboard ON dashboard_widgets(dashboard_id);
    END IF;

    -- Notifications
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notifications_tenant') THEN
        CREATE INDEX idx_notifications_tenant ON notifications(tenant_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notifications_user') THEN
        CREATE INDEX idx_notifications_user ON notifications(user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notification_queue_status') THEN
        CREATE INDEX idx_notification_queue_status ON notification_queue(status, scheduled_for);
    END IF;

    -- Audit Logs
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_audit_tenant') THEN
        CREATE INDEX idx_audit_tenant ON audit_logs(tenant_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_audit_created_at') THEN
        CREATE INDEX idx_audit_created_at ON audit_logs(created_at DESC);
    END IF;

    -- Device Events
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_device_events_tenant') THEN
        CREATE INDEX idx_device_events_tenant ON device_events(tenant_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_device_events_device') THEN
        CREATE INDEX idx_device_events_device ON device_events(device_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_device_events_created') THEN
        CREATE INDEX idx_device_events_created ON device_events(created_at DESC);
    END IF;
END $$;

-- ============================================================================
-- SECTION 10: ROW-LEVEL SECURITY
-- ============================================================================

-- Enable RLS on all tenant-scoped tables (idempotent)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry_hot ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE alarms ENABLE ROW LEVEL SECURITY;
ALTER TABLE composite_alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE firmware_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_firmware_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_bulk_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_availability_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_profiles ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (idempotent - DROP IF EXISTS then CREATE)
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
    DROP POLICY IF EXISTS telemetry_tenant_isolation ON telemetry_hot;
    CREATE POLICY telemetry_tenant_isolation ON telemetry_hot FOR ALL
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

    -- Event Types
    DROP POLICY IF EXISTS event_types_tenant_isolation ON event_types;
    CREATE POLICY event_types_tenant_isolation ON event_types FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- Device Events
    DROP POLICY IF EXISTS device_events_tenant_isolation ON device_events;
    CREATE POLICY device_events_tenant_isolation ON device_events FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- Device Availability Log
    DROP POLICY IF EXISTS availability_tenant_isolation ON device_availability_log;
    CREATE POLICY availability_tenant_isolation ON device_availability_log FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

    -- Device Profiles
    DROP POLICY IF EXISTS profiles_tenant_isolation ON device_profiles;
    CREATE POLICY profiles_tenant_isolation ON device_profiles FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);
END $$;

-- ============================================================================
-- SECTION 11: FUNCTIONS & TRIGGERS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers (idempotent - DROP IF EXISTS then CREATE)
DO $$
DECLARE
    tbl TEXT;
    tables_with_updated_at TEXT[] := ARRAY[
        'tenants', 'users', 'organizations', 'sites', 'devices', 'device_types',
        'device_groups', 'alert_rules', 'alarms', 'composite_alert_rules',
        'notification_channels', 'notification_rules', 'notification_templates',
        'notification_settings', 'firmware_versions', 'ota_campaigns',
        'group_bulk_operations', 'dashboards', 'dashboard_widgets',
        'solution_templates', 'device_profiles'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables_with_updated_at
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I_update_trigger ON %I', tbl, tbl);
        EXECUTE format('CREATE TRIGGER %I_update_trigger BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', tbl, tbl);
    END LOOP;
END $$;

-- ============================================================================
-- SECTION 12: SEED DATA (Demo Tenant & Admin)
-- ============================================================================

-- Create default tenant for testing
INSERT INTO tenants (id, name, slug, status)
VALUES (
    '00000000-0000-0000-0000-000000000001'::UUID,
    'Demo Tenant',
    'demo',
    'active'
) ON CONFLICT (id) DO NOTHING;

-- Create admin user for demo tenant (password: admin123)
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
-- This schema is production-ready and idempotent.
-- Safe to run on fresh database OR existing database.
-- ============================================================================
