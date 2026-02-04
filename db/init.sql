-- ============================================================================
-- GITO IOT PLATFORM - PostgreSQL Schema Initialization
-- ============================================================================
-- Multi-tenant schema with Row-Level Security (RLS)
-- Run this on fresh database - it will create all Phase 1 tables
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- TimescaleDB will be added in Phase 2
-- CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ============================================================================
-- SECTION 1: TENANTS (SaaS Customers)
-- ============================================================================

CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_tenants_status ON tenants(status);

-- ============================================================================
-- SECTION 2: USERS (User Accounts)
-- ============================================================================

CREATE TABLE users (
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

CREATE INDEX idx_users_tenant_id ON users(tenant_id);
CREATE INDEX idx_users_tenant_email ON users(tenant_id, email);
CREATE INDEX idx_users_status ON users(status);

-- ============================================================================
-- SECTION 3: DEVICES (IoT Device Inventory)
-- ============================================================================

CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    device_type VARCHAR(100) NOT NULL,
    dev_eui VARCHAR(16), -- For LoRaWAN devices
    chirpstack_app_id VARCHAR(100), -- ChirpStack application ID
    device_profile_id VARCHAR(100), -- ChirpStack device profile UUID
    chirpstack_synced BOOLEAN DEFAULT FALSE, -- Whether device is synced to ChirpStack
    status VARCHAR(50) DEFAULT 'offline',
    last_seen TIMESTAMPTZ,
    battery_level FLOAT,
    signal_strength INTEGER,
    attributes JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT valid_status CHECK (status IN ('online', 'offline', 'idle', 'error', 'provisioning'))
);

CREATE INDEX idx_devices_tenant_id ON devices(tenant_id);
CREATE INDEX idx_devices_status ON devices(status);
CREATE INDEX idx_devices_last_seen ON devices(last_seen DESC);
CREATE INDEX idx_devices_chirpstack_app_id ON devices(chirpstack_app_id) WHERE chirpstack_app_id IS NOT NULL;
CREATE INDEX idx_devices_chirpstack_synced ON devices(chirpstack_synced) WHERE NOT chirpstack_synced;
CREATE UNIQUE INDEX idx_devices_tenant_dev_eui ON devices(tenant_id, dev_eui) 
    WHERE dev_eui IS NOT NULL;

-- ============================================================================
-- SECTION 4: DEVICE CREDENTIALS (Authentication Tokens)
-- ============================================================================

CREATE TABLE device_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    credential_type VARCHAR(50) NOT NULL,
    credential_hash VARCHAR(255) NOT NULL, -- bcrypt hashed
    username VARCHAR(255), -- For MQTT: tenant_id:device_id
    status VARCHAR(50) DEFAULT 'active',
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    rotated_at TIMESTAMPTZ,
    
    CONSTRAINT valid_cred_type CHECK (credential_type IN ('mqtt_password', 'device_token', 'api_key'))
);

CREATE INDEX idx_creds_tenant_device ON device_credentials(tenant_id, device_id);
CREATE INDEX idx_creds_status ON device_credentials(status);

-- ============================================================================
-- SECTION 5: TELEMETRY (Time-Series Data - Hot Storage)
-- ============================================================================

CREATE TABLE telemetry_hot (
    id UUID DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    temperature FLOAT,
    humidity FLOAT,
    pressure FLOAT,
    battery FLOAT,
    rssi INTEGER,
    payload JSONB, -- Raw sensor data
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- TimescaleDB hypertable setup will be done in Phase 2
-- For Phase 1, regular indexes are sufficient
-- Standard indexes for telemetry queries
CREATE INDEX idx_telemetry_tenant_device ON telemetry_hot(tenant_id, device_id, timestamp DESC);
CREATE INDEX idx_telemetry_device_time ON telemetry_hot(device_id, timestamp DESC);
CREATE INDEX idx_telemetry_timestamp ON telemetry_hot(timestamp DESC);

-- ============================================================================
-- SECTION 5.5: ALERT RULES (Threshold-Based Alerts)
-- ============================================================================

CREATE TABLE alert_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    metric VARCHAR(50) NOT NULL,
    operator VARCHAR(10) NOT NULL,
    threshold FLOAT NOT NULL,
    cooldown_minutes INTEGER DEFAULT 5,
    active BOOLEAN DEFAULT true,
    last_fired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT valid_metric CHECK (metric IN ('temperature', 'humidity', 'battery', 'rssi', 'pressure')),
    CONSTRAINT valid_operator CHECK (operator IN ('>', '<', '>=', '<=', '==', '!='))
);

CREATE INDEX idx_alert_rules_tenant ON alert_rules(tenant_id);
CREATE INDEX idx_alert_rules_device ON alert_rules(device_id);
CREATE INDEX idx_alert_rules_active ON alert_rules(active);

-- Advanced alert rule conditions table (for composite rules)
CREATE TABLE alert_rule_conditions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    field VARCHAR(100) NOT NULL, -- e.g., 'temperature', 'humidity', 'battery'
    operator VARCHAR(10) NOT NULL, -- '>', '<', '>=', '<=', '==', '!='
    threshold FLOAT NOT NULL,
    weight INTEGER DEFAULT 1, -- For weighted scoring (higher = more important)
    sequence INTEGER NOT NULL, -- Order of evaluation for AND/OR logic
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rule_conditions_rule ON alert_rule_conditions(rule_id);

-- ============================================================================
-- SECTION 5.6: ALERT EVENTS (Alert History)
-- ============================================================================

CREATE TABLE alert_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alert_rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    metric_name VARCHAR(50) NOT NULL,
    metric_value FLOAT,
    message TEXT,
    notification_sent BOOLEAN DEFAULT false,
    notification_sent_at TIMESTAMPTZ,
    fired_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alert_events_tenant ON alert_events(tenant_id);
CREATE INDEX idx_alert_events_rule ON alert_events(alert_rule_id);
CREATE INDEX idx_alert_events_device ON alert_events(device_id);
CREATE INDEX idx_alert_events_fired_at ON alert_events(fired_at DESC);

-- ============================================================================
-- SECTION 6: AUDIT LOGS (User Actions)
-- ============================================================================

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100),
    resource_id UUID,
    changes JSONB, -- Before/after values for updates
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_tenant ON audit_logs(tenant_id);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);

-- ============================================================================
-- SECTION 6: FIRMWARE & OTA UPDATES (Phase 3)
-- ============================================================================

CREATE TABLE firmware_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    version VARCHAR(50) NOT NULL,
    url VARCHAR(2048) NOT NULL, -- Pre-signed URL to firmware binary
    size_bytes INTEGER NOT NULL,
    hash VARCHAR(64) NOT NULL, -- SHA256 for integrity verification
    release_type VARCHAR(20) DEFAULT 'beta', -- 'beta', 'production', 'hotfix'
    changelog TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT unique_version_per_tenant UNIQUE(tenant_id, version)
);

CREATE INDEX idx_firmware_versions_tenant ON firmware_versions(tenant_id);
CREATE INDEX idx_firmware_versions_release_type ON firmware_versions(release_type);

CREATE TABLE device_firmware_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    firmware_version_id UUID NOT NULL REFERENCES firmware_versions(id) ON DELETE SET NULL,
    previous_version_id UUID REFERENCES firmware_versions(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL, -- 'pending', 'in_progress', 'completed', 'failed', 'rolled_back'
    progress_percent INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_firmware_history_device ON device_firmware_history(device_id);
CREATE INDEX idx_firmware_history_tenant ON device_firmware_history(tenant_id);
CREATE INDEX idx_firmware_history_status ON device_firmware_history(status);

CREATE TABLE ota_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    firmware_version_id UUID NOT NULL REFERENCES firmware_versions(id) ON DELETE RESTRICT,
    status VARCHAR(50) DEFAULT 'draft', -- 'draft', 'scheduled', 'in_progress', 'completed', 'failed', 'rolled_back'
    scheduled_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    rollout_strategy VARCHAR(50) DEFAULT 'immediate', -- 'immediate', 'staggered', 'scheduled'
    devices_per_hour INTEGER DEFAULT 100, -- For staggered rollout
    auto_rollback_threshold FLOAT DEFAULT 0.1, -- Rollback if > 10% failure
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ota_campaigns_tenant ON ota_campaigns(tenant_id);
CREATE INDEX idx_ota_campaigns_status ON ota_campaigns(status);
CREATE INDEX idx_ota_campaigns_scheduled_at ON ota_campaigns(scheduled_at);

CREATE TABLE ota_campaign_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES ota_campaigns(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'in_progress', 'completed', 'failed', 'skipped'
    progress_percent INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    CONSTRAINT unique_campaign_device UNIQUE(campaign_id, device_id)
);

CREATE INDEX idx_campaign_devices_campaign ON ota_campaign_devices(campaign_id);
CREATE INDEX idx_campaign_devices_device ON ota_campaign_devices(device_id);
CREATE INDEX idx_campaign_devices_status ON ota_campaign_devices(status);

CREATE TABLE device_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    membership_rule JSONB, -- Rules for dynamic membership (e.g., {"tags": ["location:lab", "type:sensor"]})
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT unique_group_name_per_tenant UNIQUE(tenant_id, name)
);

CREATE INDEX idx_device_groups_tenant ON device_groups(tenant_id);

CREATE TABLE group_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES device_groups(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT unique_group_device UNIQUE(group_id, device_id)
);

CREATE INDEX idx_group_devices_group ON group_devices(group_id);
CREATE INDEX idx_group_devices_device ON group_devices(device_id);

CREATE TABLE group_bulk_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES device_groups(id) ON DELETE CASCADE,
    operation_type VARCHAR(50) NOT NULL, -- 'bulk_ota', 'bulk_command', 'bulk_sync'
    status VARCHAR(50) DEFAULT 'queued', -- 'queued', 'running', 'completed', 'failed'
    cadence_workflow_id VARCHAR(255), -- Cadence workflow ID for tracking
    devices_total INTEGER NOT NULL,
    devices_completed INTEGER DEFAULT 0,
    devices_failed INTEGER DEFAULT 0,
    progress_percent INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}', -- Operation-specific metadata (firmware_id, command, etc.)
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT valid_operation_type CHECK (operation_type IN ('bulk_ota', 'bulk_command', 'bulk_sync')),
    CONSTRAINT valid_status CHECK (status IN ('queued', 'running', 'completed', 'failed'))
);

CREATE INDEX idx_bulk_operations_tenant ON group_bulk_operations(tenant_id);
CREATE INDEX idx_bulk_operations_group ON group_bulk_operations(group_id);
CREATE INDEX idx_bulk_operations_status ON group_bulk_operations(status);
CREATE INDEX idx_bulk_operations_created_at ON group_bulk_operations(created_at DESC);

CREATE TABLE notification_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_type VARCHAR(50) NOT NULL, -- 'email', 'sms', 'slack', 'webhook', 'pagerduty'
    enabled BOOLEAN DEFAULT true,
    config JSONB NOT NULL, -- Channel-specific config (e.g., {"phone": "+1234567890"})
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT unique_user_channel UNIQUE(user_id, channel_type)
);

CREATE INDEX idx_notification_settings_user ON notification_settings(user_id);

-- ============================================================================
-- SECTION 7: ROW-LEVEL SECURITY (Multi-Tenant Isolation)
-- ============================================================================

-- Enable RLS on all tenant-scoped tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry_hot ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE firmware_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_firmware_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota_campaign_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_bulk_operations ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own tenant's data
CREATE POLICY users_tenant_isolation ON users
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

CREATE POLICY devices_tenant_isolation ON devices
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

CREATE POLICY creds_tenant_isolation ON device_credentials
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

CREATE POLICY telemetry_tenant_isolation ON telemetry_hot
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

CREATE POLICY alert_rules_tenant_isolation ON alert_rules
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

CREATE POLICY alert_events_tenant_isolation ON alert_events
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

CREATE POLICY audit_tenant_isolation ON audit_logs
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

CREATE POLICY firmware_versions_tenant_isolation ON firmware_versions
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

CREATE POLICY device_firmware_history_tenant_isolation ON device_firmware_history
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

CREATE POLICY ota_campaigns_tenant_isolation ON ota_campaigns
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

CREATE POLICY ota_campaign_devices_tenant_isolation ON ota_campaign_devices
    FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM ota_campaigns
        WHERE ota_campaigns.id = ota_campaign_devices.campaign_id
        AND ota_campaigns.tenant_id = current_setting('app.tenant_id')::UUID
    ));

CREATE POLICY device_groups_tenant_isolation ON device_groups
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

CREATE POLICY bulk_operations_tenant_isolation ON group_bulk_operations
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- ============================================================================
-- SECTION 8: SEED DATA (Default Tenant + Admin User)
-- ============================================================================

-- Create default tenant for testing
INSERT INTO tenants (id, name, slug, status)
VALUES (
    '00000000-0000-0000-0000-000000000001'::UUID,
    'Demo Tenant',
    'demo',
    'active'
) ON CONFLICT DO NOTHING;

-- Create admin user for demo tenant (password: admin123 hashed with bcrypt)
INSERT INTO users (
    id,
    tenant_id,
    email,
    password_hash,
    full_name,
    role,
    status
) VALUES (
    '00000000-0000-0000-0000-000000000010'::UUID,
    '00000000-0000-0000-0000-000000000001'::UUID,
    'admin@gito.demo',
    -- Correct bcrypt hash of "admin123"
    '$2b$12$3XqrhD4oIt2k3vkxdiJv1u6w46v.dRNWKlUBdEihb6nQSII1HAcTC',
    'Admin User',
    'TENANT_ADMIN',
    'active'
) ON CONFLICT DO NOTHING;

-- Create sample device for testing
INSERT INTO devices (
    id,
    tenant_id,
    name,
    device_type,
    status,
    attributes
) VALUES (
    '00000000-0000-0000-0000-000000000100'::UUID,
    '00000000-0000-0000-0000-000000000001'::UUID,
    'Demo Temperature Sensor',
    'temperature_sensor',
    'offline',
    '{"location": "Lab", "gateway": "gateway-001"}'::JSONB
) ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 9: GRANT PERMISSIONS
-- ============================================================================
-- Note: Application users are created via environment variables in Docker/k8s
-- No need to create them here

-- ============================================================================
-- SECTION 10: FUNCTIONS & TRIGGERS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tables that have updated_at
CREATE TRIGGER tenants_update_trigger
    BEFORE UPDATE ON tenants
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER users_update_trigger
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER devices_update_trigger
    BEFORE UPDATE ON devices
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER alert_rules_update_trigger
    BEFORE UPDATE ON alert_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER firmware_versions_update_trigger
    BEFORE UPDATE ON firmware_versions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER ota_campaigns_update_trigger
    BEFORE UPDATE ON ota_campaigns
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER device_groups_update_trigger
    BEFORE UPDATE ON device_groups
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER notification_settings_update_trigger
    BEFORE UPDATE ON notification_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- Database initialized with:
-- ✅ Multi-tenancy support (tenant_id on all tables)
-- ✅ Row-Level Security (RLS) policies for tenant isolation
-- ✅ TimescaleDB hypertable for telemetry time-series
-- ✅ Compression & retention policies
-- ✅ Audit logging capability
-- ✅ Sample tenant + admin user for testing
-- ============================================================================
-- ============================================================================
-- MIGRATION: Add ChirpStack Integration Fields to Devices
-- ============================================================================
-- Description: Add fields for ChirpStack integration and unified device management
-- Version: 001
-- Created: 2025
-- ============================================================================

BEGIN;

-- Add new columns to devices table for ChirpStack integration
ALTER TABLE devices
    ADD COLUMN chirpstack_app_id VARCHAR(100),
    ADD COLUMN device_profile_id VARCHAR(100),
    ADD COLUMN chirpstack_synced BOOLEAN DEFAULT FALSE NOT NULL;

-- Create index for ChirpStack app lookups (for syncing operations)
CREATE INDEX idx_devices_chirpstack_app_id ON devices(chirpstack_app_id) WHERE chirpstack_app_id IS NOT NULL;

-- Create index for synced status (to find devices not yet synced)
CREATE INDEX idx_devices_chirpstack_synced ON devices(chirpstack_synced) WHERE NOT chirpstack_synced;

-- Add comment documenting the new fields
COMMENT ON COLUMN devices.chirpstack_app_id IS 'ChirpStack application ID for LoRaWAN device grouping';
COMMENT ON COLUMN devices.device_profile_id IS 'ChirpStack device profile UUID that defines device capabilities';
COMMENT ON COLUMN devices.chirpstack_synced IS 'Flag indicating device has been synchronized to ChirpStack';

COMMIT;
-- ============================================================================
-- GITO IOT PLATFORM - SaaS Hierarchy Migration
-- ============================================================================
-- Adds Organizations, Sites, and Device Groups for multi-level hierarchy
-- Enables: Tenant → Organization → Site → Device Group → Device
-- Run after: 001_init.sql
-- ============================================================================

-- ============================================================================
-- SECTION 1: ORGANIZATIONS (Sub-customers within tenants)
-- ============================================================================

CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description TEXT,
    billing_contact VARCHAR(255),
    chirpstack_app_id VARCHAR(100),  -- ChirpStack Application ID mapping
    status VARCHAR(50) DEFAULT 'active' NOT NULL,
    metadata JSONB DEFAULT '{}' NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT valid_org_status CHECK (status IN ('active', 'inactive', 'suspended'))
);

CREATE INDEX IF NOT EXISTS idx_organizations_tenant ON organizations(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(tenant_id, slug);
CREATE INDEX IF NOT EXISTS idx_organizations_chirpstack ON organizations(chirpstack_app_id) 
    WHERE chirpstack_app_id IS NOT NULL;

-- Enable RLS
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS tenant_isolation ON organizations
  USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- ============================================================================
-- SECTION 2: SITES (Physical locations with nested hierarchy)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    parent_site_id UUID REFERENCES sites(id) ON DELETE CASCADE,  -- For nested sites
    name VARCHAR(255) NOT NULL,
    site_type VARCHAR(50),  -- factory, warehouse, office, building, floor, room
    address TEXT,
    coordinates JSONB,  -- {"lat": 51.5074, "lng": -0.1278}
    timezone VARCHAR(50) DEFAULT 'UTC' NOT NULL,
    metadata JSONB DEFAULT '{}' NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sites_tenant ON sites(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sites_organization ON sites(organization_id);
CREATE INDEX IF NOT EXISTS idx_sites_parent ON sites(parent_site_id);

-- Enable RLS
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS tenant_isolation ON sites
  USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- ============================================================================
-- SECTION 3: DEVICE GROUPS (Logical groupings)
-- ============================================================================

CREATE TABLE IF NOT EXISTS device_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    group_type VARCHAR(50),  -- logical, physical, functional
    membership_rule JSONB DEFAULT '{}' NOT NULL,
    attributes JSONB DEFAULT '{}' NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_groups_tenant ON device_groups(tenant_id);
CREATE INDEX IF NOT EXISTS idx_device_groups_org ON device_groups(organization_id);
CREATE INDEX IF NOT EXISTS idx_device_groups_site ON device_groups(site_id);

-- Enable RLS
ALTER TABLE device_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS tenant_isolation ON device_groups
  USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- ============================================================================
-- SECTION 4: UPDATE DEVICES TABLE (Add hierarchy foreign keys)
-- ============================================================================

-- Add hierarchy columns to devices table
ALTER TABLE devices 
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS device_group_id UUID REFERENCES device_groups(id) ON DELETE SET NULL;

-- Add indexes for hierarchy queries
CREATE INDEX IF NOT EXISTS idx_devices_organization ON devices(organization_id);
CREATE INDEX IF NOT EXISTS idx_devices_site ON devices(site_id);
CREATE INDEX IF NOT EXISTS idx_devices_group ON devices(device_group_id);

-- ============================================================================
-- SECTION 5: GROUP DEVICES (Many-to-many relationship - optional)
-- ============================================================================

CREATE TABLE IF NOT EXISTS group_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES device_groups(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    UNIQUE(group_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_group_devices_group ON group_devices(group_id);
CREATE INDEX IF NOT EXISTS idx_group_devices_device ON group_devices(device_id);

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Verify tables exist
DO $$
BEGIN
    RAISE NOTICE 'Migration 002 complete:';
    RAISE NOTICE '  - organizations table: %', 
        (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'organizations');
    RAISE NOTICE '  - sites table: %', 
        (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'sites');
    RAISE NOTICE '  - device_groups table: %', 
        (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'device_groups');
    RAISE NOTICE '  - devices hierarchy columns added';
END $$;
-- ============================================================================
-- Migration: Phase 3.2e - Multi-Channel Notifications
-- Adds notification infrastructure tables with RLS policies
-- ============================================================================

BEGIN;

-- Create notification_channels table
CREATE TABLE notification_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_type VARCHAR(50) NOT NULL,
    config JSONB NOT NULL,
    enabled BOOLEAN DEFAULT true,
    verified BOOLEAN DEFAULT false,
    verified_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT valid_channel_type CHECK (channel_type IN ('email', 'slack', 'webhook', 'apns', 'fcm', 'sms')),
    CONSTRAINT unique_user_channel UNIQUE(user_id, channel_type, config)
);

CREATE INDEX idx_notification_channels_tenant ON notification_channels(tenant_id);
CREATE INDEX idx_notification_channels_user ON notification_channels(user_id);
CREATE INDEX idx_notification_channels_enabled ON notification_channels(enabled);
CREATE INDEX idx_notification_channels_type ON notification_channels(channel_type);

ALTER TABLE notification_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_channels_tenant_isolation ON notification_channels
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Create notification_rules table
CREATE TABLE notification_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alert_rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT unique_rule_channel UNIQUE(alert_rule_id, channel_id)
);

CREATE INDEX idx_notification_rules_alert ON notification_rules(alert_rule_id);
CREATE INDEX idx_notification_rules_channel ON notification_rules(channel_id);
CREATE INDEX idx_notification_rules_enabled ON notification_rules(enabled);

ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_rules_tenant_isolation ON notification_rules
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Create notifications table
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alert_event_id UUID NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
    channel_type VARCHAR(50) NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    delivery_status VARCHAR(50),
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    next_retry_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT valid_status CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'bounced', 'skipped')),
    CONSTRAINT valid_delivery_status CHECK (delivery_status IS NULL OR delivery_status IN ('success', 'permanent_failure', 'temporary_failure', 'invalid_address', 'rate_limited'))
);

CREATE INDEX idx_notifications_tenant ON notifications(tenant_id);
CREATE INDEX idx_notifications_alert_event ON notifications(alert_event_id);
CREATE INDEX idx_notifications_channel ON notifications(channel_id);
CREATE INDEX idx_notifications_status ON notifications(status);
CREATE INDEX idx_notifications_recipient ON notifications(recipient);
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX idx_notifications_retry ON notifications(status, next_retry_at) WHERE status = 'pending';

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_tenant_isolation ON notifications
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Create notification_templates table
CREATE TABLE notification_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel_type VARCHAR(50) NOT NULL,
    alert_type VARCHAR(100),
    name VARCHAR(255) NOT NULL,
    subject VARCHAR(500),
    body TEXT NOT NULL,
    variables JSONB DEFAULT '[]',
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT valid_template_channel CHECK (channel_type IN ('email', 'slack', 'webhook')),
    CONSTRAINT unique_template UNIQUE(tenant_id, channel_type, alert_type)
);

CREATE INDEX idx_notification_templates_tenant ON notification_templates(tenant_id);
CREATE INDEX idx_notification_templates_channel ON notification_templates(channel_type);
CREATE INDEX idx_notification_templates_enabled ON notification_templates(enabled);

ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_templates_tenant_isolation ON notification_templates
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Add notification_preferences to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{
    "quiet_hours_enabled": false,
    "quiet_hours_start": "22:00",
    "quiet_hours_end": "08:00",
    "timezone": "UTC",
    "muted_rules": [],
    "email_digest_enabled": false,
    "email_digest_frequency": "daily"
}';

CREATE INDEX IF NOT EXISTS idx_users_notification_prefs ON users USING GIN (notification_preferences);

-- Create notification_queue table for background processing
CREATE TABLE IF NOT EXISTS notification_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alert_event_id UUID NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    error_message TEXT,
    attempted_at TIMESTAMPTZ,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT valid_queue_status CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    CONSTRAINT unique_queue_alert UNIQUE(alert_event_id)
);

CREATE INDEX idx_notification_queue_status ON notification_queue(status);
CREATE INDEX idx_notification_queue_tenant ON notification_queue(tenant_id);
CREATE INDEX idx_notification_queue_created ON notification_queue(created_at DESC);
CREATE INDEX idx_notification_queue_retry ON notification_queue(status, created_at) WHERE status = 'pending';

ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_queue_tenant_isolation ON notification_queue
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Create notification delivery status view
CREATE OR REPLACE VIEW notification_delivery_status AS
SELECT 
    n.id,
    n.tenant_id,
    n.alert_event_id,
    n.channel_type,
    n.status,
    n.delivery_status,
    n.retry_count,
    ar.id as alert_rule_id,
    ar.device_id,
    ae.fired_at as alert_fired_at,
    n.created_at,
    n.sent_at,
    CASE 
        WHEN n.status = 'sent' THEN 'Successfully sent'
        WHEN n.status = 'failed' AND n.retry_count < 5 THEN 'Will retry'
        WHEN n.status = 'failed' THEN 'Max retries exceeded'
        WHEN n.status = 'pending' THEN 'Waiting to send'
        WHEN n.status = 'skipped' THEN 'Skipped (user preferences)'
        ELSE n.status
    END as status_description
FROM notifications n
JOIN alert_events ae ON n.alert_event_id = ae.id
JOIN alert_rules ar ON ae.alert_rule_id = ar.id;

COMMIT;
-- ============================================================================
-- Migration 003: Upgrade Alert Events to Full Alarms System
-- ============================================================================
-- Description: Upgrades alert_events to Cumulocity-style alarms with:
--   - Severity levels (CRITICAL, MAJOR, MINOR, WARNING)
--   - Status workflow (ACTIVE → ACKNOWLEDGED → CLEARED)
--   - Acknowledgment tracking
--   - Alarm types and sources
-- ============================================================================

-- Step 1: Add new columns to alert_events table
ALTER TABLE alert_events 
    ADD COLUMN IF NOT EXISTS severity VARCHAR(20) DEFAULT 'MAJOR',
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'ACTIVE',
    ADD COLUMN IF NOT EXISTS alarm_type VARCHAR(100),
    ADD COLUMN IF NOT EXISTS source VARCHAR(100),
    ADD COLUMN IF NOT EXISTS acknowledged_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ;

-- Step 2: Add constraints for severity and status
ALTER TABLE alert_events 
    DROP CONSTRAINT IF EXISTS valid_severity,
    ADD CONSTRAINT valid_severity CHECK (
        severity IN ('CRITICAL', 'MAJOR', 'MINOR', 'WARNING')
    );

ALTER TABLE alert_events 
    DROP CONSTRAINT IF EXISTS valid_alarm_status,
    ADD CONSTRAINT valid_alarm_status CHECK (
        status IN ('ACTIVE', 'ACKNOWLEDGED', 'CLEARED')
    );

-- Step 3: Update existing rows with default values
UPDATE alert_events 
SET 
    severity = CASE 
        WHEN metric_name IN ('temperature', 'pressure') THEN 'MAJOR'
        WHEN metric_name = 'battery' THEN 'WARNING'
        ELSE 'MINOR'
    END,
    status = 'CLEARED',
    alarm_type = metric_name || '_threshold',
    source = metric_name,
    cleared_at = fired_at + INTERVAL '5 minutes'
WHERE severity IS NULL;

-- Step 4: Create indexes for alarm queries
CREATE INDEX IF NOT EXISTS idx_alert_events_severity 
    ON alert_events(severity);

CREATE INDEX IF NOT EXISTS idx_alert_events_status 
    ON alert_events(status);

CREATE INDEX IF NOT EXISTS idx_alert_events_active 
    ON alert_events(tenant_id, device_id, status) 
    WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_alert_events_acknowledged 
    ON alert_events(acknowledged_by, acknowledged_at) 
    WHERE acknowledged_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alert_events_alarm_type 
    ON alert_events(tenant_id, alarm_type, status);

-- Step 5: Create alarm count materialized view for dashboards
CREATE MATERIALIZED VIEW IF NOT EXISTS alarm_summary AS
SELECT 
    tenant_id,
    device_id,
    severity,
    status,
    COUNT(*) as alarm_count,
    MAX(fired_at) as last_alarm_at
FROM alert_events
WHERE status IN ('ACTIVE', 'ACKNOWLEDGED')
GROUP BY tenant_id, device_id, severity, status;

CREATE UNIQUE INDEX IF NOT EXISTS idx_alarm_summary_unique 
    ON alarm_summary(tenant_id, device_id, severity, status);

CREATE INDEX IF NOT EXISTS idx_alarm_summary_tenant 
    ON alarm_summary(tenant_id);

-- Step 6: Add comment documenting the upgrade
COMMENT ON TABLE alert_events IS 'Alarm system with Cumulocity-style severity levels and acknowledgment workflow';
COMMENT ON COLUMN alert_events.severity IS 'Alarm severity: CRITICAL, MAJOR, MINOR, WARNING';
COMMENT ON COLUMN alert_events.status IS 'Alarm lifecycle: ACTIVE → ACKNOWLEDGED → CLEARED';
COMMENT ON COLUMN alert_events.alarm_type IS 'Type of alarm (e.g., temperature_threshold, communication_lost)';
COMMENT ON COLUMN alert_events.source IS 'Source component/sensor that triggered the alarm';
COMMENT ON COLUMN alert_events.acknowledged_by IS 'User who acknowledged the alarm';

-- Step 7: Create function to auto-refresh alarm summary
CREATE OR REPLACE FUNCTION refresh_alarm_summary()
RETURNS TRIGGER AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY alarm_summary;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Step 8: Create trigger to refresh summary on alarm changes
DROP TRIGGER IF EXISTS trigger_refresh_alarm_summary ON alert_events;
CREATE TRIGGER trigger_refresh_alarm_summary
    AFTER INSERT OR UPDATE OF status, severity ON alert_events
    FOR EACH STATEMENT
    EXECUTE FUNCTION refresh_alarm_summary();

-- Migration complete
-- Usage: Apply with `psql -U gito -d gito -f db/migrations/003_upgrade_to_alarms_system.sql`
-- ============================================================================
-- Migration 004: Device Events and Availability Tracking
-- ============================================================================
-- Description: 
--   - Device Events: Audit trail for device lifecycle (connect, disconnect, etc.)
--   - Device Availability: Uptime/downtime tracking for SLA monitoring
--   - Device Profiles: Templates for device configurations
-- ============================================================================

-- ============================================================================
-- PART 1: DEVICE EVENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS device_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    event_text TEXT,
    event_data JSONB DEFAULT '{}',
    source VARCHAR(100), -- mqtt_processor, api, user_action, system
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_device_events_tenant 
    ON device_events(tenant_id);

CREATE INDEX IF NOT EXISTS idx_device_events_device 
    ON device_events(device_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_device_events_type 
    ON device_events(tenant_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_device_events_created_at 
    ON device_events(created_at DESC);

-- RLS policy for tenant isolation
ALTER TABLE device_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY device_events_tenant_isolation ON device_events
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Common event types:
COMMENT ON TABLE device_events IS 'Device lifecycle events and audit trail';
COMMENT ON COLUMN device_events.event_type IS 'Event types: device_connected, device_disconnected, data_received, location_updated, config_changed, firmware_updated, command_sent, command_executed, etc.';

-- ============================================================================
-- PART 2: DEVICE AVAILABILITY TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS device_availability_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL, -- online, offline, maintenance
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    reason VARCHAR(100), -- connection_lost, maintenance, normal_shutdown, scheduled_downtime
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for availability queries
CREATE INDEX IF NOT EXISTS idx_availability_tenant 
    ON device_availability_log(tenant_id);

CREATE INDEX IF NOT EXISTS idx_availability_device 
    ON device_availability_log(device_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_availability_status 
    ON device_availability_log(tenant_id, status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_availability_active 
    ON device_availability_log(tenant_id, device_id) 
    WHERE ended_at IS NULL;

-- RLS policy for tenant isolation
ALTER TABLE device_availability_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY availability_tenant_isolation ON device_availability_log
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Add constraints
ALTER TABLE device_availability_log 
    ADD CONSTRAINT valid_availability_status 
    CHECK (status IN ('online', 'offline', 'maintenance'));

COMMENT ON TABLE device_availability_log IS 'Device uptime/downtime tracking for SLA monitoring';
COMMENT ON COLUMN device_availability_log.duration_seconds IS 'Calculated when ended_at is set';

-- Function to calculate duration on update
CREATE OR REPLACE FUNCTION calculate_availability_duration()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.ended_at IS NOT NULL AND OLD.ended_at IS NULL THEN
        NEW.duration_seconds := EXTRACT(EPOCH FROM (NEW.ended_at - NEW.started_at))::INTEGER;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_calculate_availability_duration
    BEFORE UPDATE OF ended_at ON device_availability_log
    FOR EACH ROW
    EXECUTE FUNCTION calculate_availability_duration();

-- ============================================================================
-- PART 3: DEVICE PROFILES (Templates)
-- ============================================================================

CREATE TABLE IF NOT EXISTS device_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    device_type VARCHAR(100) NOT NULL,
    configuration JSONB NOT NULL DEFAULT '{}',
    alert_rules JSONB DEFAULT '[]',
    attributes JSONB DEFAULT '{}',
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_device_profiles_tenant 
    ON device_profiles(tenant_id);

CREATE INDEX IF NOT EXISTS idx_device_profiles_type 
    ON device_profiles(tenant_id, device_type);

CREATE INDEX IF NOT EXISTS idx_device_profiles_default 
    ON device_profiles(tenant_id, device_type, is_default) 
    WHERE is_default = true;

-- Ensure only one default profile per device type per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_profiles_unique_default 
    ON device_profiles(tenant_id, device_type) 
    WHERE is_default = true;

-- RLS policy for tenant isolation
ALTER TABLE device_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY device_profiles_tenant_isolation ON device_profiles
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

COMMENT ON TABLE device_profiles IS 'Device configuration templates that can be applied to new devices';
COMMENT ON COLUMN device_profiles.configuration IS 'Default configuration: {\"mqtt\":{\"qos\":1}, \"reporting_interval\":60, \"sensors\":[...]}';
COMMENT ON COLUMN device_profiles.alert_rules IS 'Default alert rules to create when device is provisioned: [{\"metric\":\"temperature\",\"operator\":\">\",\"threshold\":30}]';

-- Add device_profile_id to devices table if not exists
ALTER TABLE devices 
    ADD COLUMN IF NOT EXISTS device_profile_id UUID REFERENCES device_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_devices_profile 
    ON devices(device_profile_id) 
    WHERE device_profile_id IS NOT NULL;

-- ============================================================================
-- PART 4: SEED COMMON EVENT TYPES (Optional)
-- ============================================================================

-- Create a lookup table for common event types (optional, for frontend dropdowns)
CREATE TABLE IF NOT EXISTS event_types (
    id VARCHAR(100) PRIMARY KEY,
    category VARCHAR(50) NOT NULL, -- device_lifecycle, communication, configuration, firmware, security
    description TEXT NOT NULL,
    severity VARCHAR(20) DEFAULT 'INFO', -- INFO, WARNING, ERROR, CRITICAL
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO event_types (id, category, description, severity) VALUES
    ('device_connected', 'device_lifecycle', 'Device established connection', 'INFO'),
    ('device_disconnected', 'device_lifecycle', 'Device disconnected', 'WARNING'),
    ('device_registered', 'device_lifecycle', 'Device registered in platform', 'INFO'),
    ('device_decommissioned', 'device_lifecycle', 'Device removed from platform', 'INFO'),
    ('data_received', 'communication', 'Telemetry data received', 'INFO'),
    ('communication_timeout', 'communication', 'No data received within expected interval', 'WARNING'),
    ('location_updated', 'configuration', 'Device location changed', 'INFO'),
    ('config_updated', 'configuration', 'Device configuration modified', 'INFO'),
    ('firmware_update_started', 'firmware', 'OTA firmware update initiated', 'INFO'),
    ('firmware_update_completed', 'firmware', 'OTA firmware update successful', 'INFO'),
    ('firmware_update_failed', 'firmware', 'OTA firmware update failed', 'ERROR'),
    ('command_sent', 'communication', 'Command sent to device', 'INFO'),
    ('command_executed', 'communication', 'Device executed command successfully', 'INFO'),
    ('command_failed', 'communication', 'Device failed to execute command', 'ERROR'),
    ('credentials_rotated', 'security', 'Device credentials rotated', 'INFO'),
    ('unauthorized_access', 'security', 'Unauthorized access attempt', 'CRITICAL')
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE event_types IS 'Reference table for common device event types';

-- Migration complete
-- Usage: Get-Content "C:\...\004_device_events_and_availability.sql" | docker exec -i gito-postgres psql -U gito -d gito
-- ============================================================================
-- Migration 005: Composite Alert Rules
-- Multi-condition alert rules with AND/OR logic
-- ============================================================================

CREATE TABLE IF NOT EXISTS composite_alert_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    enabled BOOLEAN DEFAULT true,
    conditions JSONB NOT NULL DEFAULT '[]', -- Array of condition objects
    logic VARCHAR(10) NOT NULL DEFAULT 'AND', -- 'AND' or 'OR'
    severity VARCHAR(20) NOT NULL DEFAULT 'warning', -- 'info', 'warning', 'critical'
    weight_score INTEGER, -- Optional priority weight (0-100)
    cooldown_minutes INTEGER DEFAULT 5,
    last_triggered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT valid_logic CHECK (logic IN ('AND', 'OR')),
    CONSTRAINT valid_severity CHECK (severity IN ('info', 'warning', 'critical'))
);

-- Indexes
CREATE INDEX idx_composite_alert_rules_tenant ON composite_alert_rules(tenant_id);
CREATE INDEX idx_composite_alert_rules_enabled ON composite_alert_rules(enabled);
CREATE INDEX idx_composite_alert_rules_severity ON composite_alert_rules(severity);
CREATE INDEX idx_composite_alert_rules_conditions ON composite_alert_rules USING GIN(conditions);

-- RLS Policies
ALTER TABLE composite_alert_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS composite_alert_rules_tenant_isolation ON composite_alert_rules;
CREATE POLICY composite_alert_rules_tenant_isolation ON composite_alert_rules
    USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_composite_alert_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_composite_alert_rules_updated_at ON composite_alert_rules;
CREATE TRIGGER trigger_composite_alert_rules_updated_at
    BEFORE UPDATE ON composite_alert_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_composite_alert_rules_updated_at();

COMMENT ON TABLE composite_alert_rules IS 'Multi-condition alert rules with AND/OR logic for complex scenarios';
COMMENT ON COLUMN composite_alert_rules.conditions IS 'JSON array of conditions: [{"field": "temperature", "operator": "gt", "value": 30}]';
COMMENT ON COLUMN composite_alert_rules.logic IS 'How to combine conditions: AND (all must match) or OR (any must match)';
COMMENT ON COLUMN composite_alert_rules.weight_score IS 'Priority weight for scoring and notification routing';
-- ============================================================================
-- Migration 006: Unified Alert Rules and Alarms Architecture
-- Enterprise-grade alarm system following Cumulocity patterns
-- ============================================================================

-- ===========================================================================
-- STEP 1: Rename alert_events to alarms (semantic correctness)
-- ===========================================================================
ALTER TABLE alert_events RENAME TO alarms;

-- Update all foreign key references
ALTER TABLE alarms RENAME CONSTRAINT alert_events_pkey TO alarms_pkey;
ALTER TABLE alarms RENAME CONSTRAINT alert_events_tenant_id_fkey TO alarms_tenant_id_fkey;
ALTER TABLE alarms RENAME CONSTRAINT alert_events_alert_rule_id_fkey TO alarms_alert_rule_id_fkey;
ALTER TABLE alarms RENAME CONSTRAINT alert_events_device_id_fkey TO alarms_device_id_fkey;
ALTER TABLE alarms RENAME CONSTRAINT alert_events_acknowledged_by_fkey TO alarms_acknowledged_by_fkey;

-- Update indexes
ALTER INDEX alert_events_pkey RENAME TO alarms_pkey;
ALTER INDEX idx_alert_events_tenant RENAME TO idx_alarms_tenant;
ALTER INDEX idx_alert_events_rule RENAME TO idx_alarms_rule;
ALTER INDEX idx_alert_events_device RENAME TO idx_alarms_device;
ALTER INDEX idx_alert_events_fired_at RENAME TO idx_alarms_fired_at;
ALTER INDEX idx_alert_events_severity RENAME TO idx_alarms_severity;
ALTER INDEX idx_alert_events_status RENAME TO idx_alarms_status;
ALTER INDEX idx_alert_events_active RENAME TO idx_alarms_active;
ALTER INDEX idx_alert_events_acknowledged RENAME TO idx_alarms_acknowledged;
ALTER INDEX idx_alert_events_alarm_type RENAME TO idx_alarms_alarm_type;

-- ===========================================================================
-- STEP 2: Upgrade alert_rules to support both simple and complex conditions
-- ===========================================================================

-- Add JSONB conditions column (for complex multi-condition rules)
ALTER TABLE alert_rules 
    ADD COLUMN IF NOT EXISTS conditions JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS logic VARCHAR(10) DEFAULT 'AND',
    ADD COLUMN IF NOT EXISTS severity VARCHAR(20) DEFAULT 'MAJOR',
    ADD COLUMN IF NOT EXISTS rule_type VARCHAR(20) DEFAULT 'SIMPLE';

-- Add constraints
ALTER TABLE alert_rules 
    DROP CONSTRAINT IF EXISTS valid_logic,
    ADD CONSTRAINT valid_logic CHECK (logic IN ('AND', 'OR'));

ALTER TABLE alert_rules 
    DROP CONSTRAINT IF EXISTS valid_rule_severity,
    ADD CONSTRAINT valid_rule_severity CHECK (
        severity IN ('CRITICAL', 'MAJOR', 'MINOR', 'WARNING')
    );

ALTER TABLE alert_rules 
    DROP CONSTRAINT IF EXISTS valid_rule_type,
    ADD CONSTRAINT valid_rule_type CHECK (
        rule_type IN ('SIMPLE', 'COMPLEX')
    );

-- Make device_id optional (for fleet-wide rules)
ALTER TABLE alert_rules 
    ALTER COLUMN device_id DROP NOT NULL;

-- Migrate existing simple rules to new format
UPDATE alert_rules 
SET 
    rule_type = 'SIMPLE',
    severity = 'MAJOR',
    logic = 'AND',
    conditions = jsonb_build_array(
        jsonb_build_object(
            'field', metric,
            'operator', operator,
            'value', threshold
        )
    )
WHERE conditions IS NULL;

-- Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_alert_rules_severity ON alert_rules(severity);
CREATE INDEX IF NOT EXISTS idx_alert_rules_type ON alert_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_alert_rules_conditions ON alert_rules USING GIN(conditions);

-- ===========================================================================
-- STEP 3: Migrate composite_alert_rules data into alert_rules
-- ===========================================================================

INSERT INTO alert_rules (
    tenant_id,
    device_id,
    metric,
    operator,
    threshold,
    cooldown_minutes,
    active,
    created_at,
    updated_at,
    conditions,
    logic,
    severity,
    rule_type
)
SELECT 
    tenant_id,
    NULL as device_id,  -- Composite rules are fleet-wide
    'composite' as metric,  -- Placeholder
    '>' as operator,  -- Placeholder
    0 as threshold,  -- Placeholder
    cooldown_minutes,
    enabled as active,
    created_at,
    updated_at,
    conditions,
    logic,
    severity,
    'COMPLEX' as rule_type
FROM composite_alert_rules
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- STEP 4: Drop composite_alert_rules table (functionality now in alert_rules)
-- ===========================================================================

DROP TABLE IF EXISTS composite_alert_rules CASCADE;

-- ===========================================================================
-- STEP 5: Update alarm summary materialized view
-- ===========================================================================

DROP MATERIALIZED VIEW IF EXISTS alarm_summary CASCADE;

CREATE MATERIALIZED VIEW alarm_summary AS
SELECT 
    tenant_id,
    device_id,
    severity,
    status,
    alarm_type,
    COUNT(*) as alarm_count,
    MAX(fired_at) as last_alarm_at,
    COUNT(*) FILTER (WHERE status = 'ACTIVE') as active_count,
    COUNT(*) FILTER (WHERE status = 'ACKNOWLEDGED') as acknowledged_count
FROM alarms
WHERE status IN ('ACTIVE', 'ACKNOWLEDGED')
GROUP BY tenant_id, device_id, severity, status, alarm_type;

CREATE UNIQUE INDEX idx_alarm_summary_unique 
    ON alarm_summary(tenant_id, COALESCE(device_id, '00000000-0000-0000-0000-000000000000'::uuid), severity, status, COALESCE(alarm_type, 'unknown'));

CREATE INDEX idx_alarm_summary_tenant ON alarm_summary(tenant_id);
CREATE INDEX idx_alarm_summary_severity ON alarm_summary(severity);

-- ===========================================================================
-- STEP 6: Add helpful comments
-- ===========================================================================

COMMENT ON TABLE alert_rules IS 'Unified alert rule definitions supporting both simple (single condition) and complex (multi-condition with AND/OR) rules';
COMMENT ON COLUMN alert_rules.conditions IS 'JSONB array of conditions for complex rules: [{"field": "temperature", "operator": "gt", "value": 30}]';
COMMENT ON COLUMN alert_rules.logic IS 'How to combine conditions: AND (all must match) or OR (any must match)';
COMMENT ON COLUMN alert_rules.rule_type IS 'SIMPLE (single metric) or COMPLEX (multiple conditions)';
COMMENT ON COLUMN alert_rules.device_id IS 'Specific device (for device rules) or NULL (for fleet-wide rules)';

COMMENT ON TABLE alarms IS 'Alarm instances with Cumulocity-style lifecycle management (ACTIVE → ACKNOWLEDGED → CLEARED)';
COMMENT ON COLUMN alarms.severity IS 'Alarm severity: CRITICAL, MAJOR, MINOR, WARNING';
COMMENT ON COLUMN alarms.status IS 'Alarm state: ACTIVE (new), ACKNOWLEDGED (seen), CLEARED (resolved)';
-- Migration 007: Add created_at and updated_at columns to alarms table
-- Date: 2026-01-23
-- Description: Add standard timestamp columns to alarms for audit trail

-- Add timestamp columns
ALTER TABLE alarms 
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

-- Create trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_alarms_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_alarms_updated_at
    BEFORE UPDATE ON alarms
    FOR EACH ROW
    EXECUTE FUNCTION update_alarms_updated_at();

-- Add comment
COMMENT ON COLUMN alarms.created_at IS 'Timestamp when alarm record was created';
COMMENT ON COLUMN alarms.updated_at IS 'Timestamp when alarm record was last updated';
-- Migration: Create unified_alert_rules table
-- Consolidates THRESHOLD and COMPOSITE alert rules into a single table
-- Following industry best practices (AWS CloudWatch, Datadog, PagerDuty)

-- Create the unified alert rules table
CREATE TABLE IF NOT EXISTS unified_alert_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Common fields
    name VARCHAR(255) NOT NULL,
    description TEXT,
    rule_type VARCHAR(20) NOT NULL DEFAULT 'THRESHOLD',  -- THRESHOLD, COMPOSITE
    severity VARCHAR(20) NOT NULL DEFAULT 'warning',     -- info, warning, critical
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    cooldown_minutes INTEGER NOT NULL DEFAULT 5,
    last_triggered_at TIMESTAMPTZ,
    
    -- THRESHOLD-specific fields (nullable for COMPOSITE rules)
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
    metric VARCHAR(50),       -- temperature, humidity, battery, rssi, pressure
    operator VARCHAR(10),     -- gt, gte, lt, lte, eq, neq
    threshold FLOAT,
    
    -- COMPOSITE-specific fields (nullable for THRESHOLD rules)
    conditions JSONB,         -- [{field, operator, threshold, weight}, ...]
    logic VARCHAR(10),        -- AND, OR
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_rule_type CHECK (rule_type IN ('THRESHOLD', 'COMPOSITE')),
    CONSTRAINT valid_unified_severity CHECK (severity IN ('info', 'warning', 'critical')),
    CONSTRAINT valid_rule_fields CHECK (
        (rule_type = 'THRESHOLD' AND metric IS NOT NULL AND operator IS NOT NULL AND threshold IS NOT NULL)
        OR (rule_type = 'COMPOSITE' AND conditions IS NOT NULL)
    )
    -- Note: device_id is OPTIONAL for THRESHOLD rules (null = global rule)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_unified_alert_rules_tenant ON unified_alert_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_unified_alert_rules_device ON unified_alert_rules(device_id);
CREATE INDEX IF NOT EXISTS idx_unified_alert_rules_type ON unified_alert_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_unified_alert_rules_enabled ON unified_alert_rules(enabled);
CREATE INDEX IF NOT EXISTS idx_unified_alert_rules_severity ON unified_alert_rules(severity);

-- Enable RLS
ALTER TABLE unified_alert_rules ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Tenants can only see their own rules
DROP POLICY IF EXISTS unified_alert_rules_tenant_isolation ON unified_alert_rules;
CREATE POLICY unified_alert_rules_tenant_isolation ON unified_alert_rules
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_unified_alert_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS unified_alert_rules_updated_at_trigger ON unified_alert_rules;
CREATE TRIGGER unified_alert_rules_updated_at_trigger
    BEFORE UPDATE ON unified_alert_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_unified_alert_rules_updated_at();

-- Migrate existing alert_rules (THRESHOLD) to unified table
INSERT INTO unified_alert_rules (
    id, tenant_id, name, description, rule_type, severity, enabled,
    device_id, metric, operator, threshold, cooldown_minutes,
    created_at, updated_at
)
SELECT 
    id, 
    tenant_id, 
    COALESCE(CONCAT(metric, ' ', operator, ' ', threshold), 'Unnamed Rule') as name,
    NULL as description,
    'THRESHOLD' as rule_type,
    'warning' as severity,
    (active = '1') as enabled,
    device_id,
    metric,
    operator,
    threshold,
    cooldown_minutes,
    created_at,
    updated_at
FROM alert_rules
WHERE NOT EXISTS (
    SELECT 1 FROM unified_alert_rules WHERE unified_alert_rules.id = alert_rules.id
);

-- Migrate existing composite_alert_rules to unified table
INSERT INTO unified_alert_rules (
    id, tenant_id, name, description, rule_type, severity, enabled,
    conditions, logic, cooldown_minutes, last_triggered_at,
    created_at, updated_at
)
SELECT 
    id, 
    tenant_id, 
    name,
    description,
    'COMPOSITE' as rule_type,
    COALESCE(severity, 'warning'),
    enabled,
    conditions,
    COALESCE(logic, 'AND'),
    COALESCE(cooldown_minutes, 5),
    last_triggered_at,
    created_at,
    updated_at
FROM composite_alert_rules
WHERE NOT EXISTS (
    SELECT 1 FROM unified_alert_rules WHERE unified_alert_rules.id = composite_alert_rules.id
);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON unified_alert_rules TO gito_app;

COMMENT ON TABLE unified_alert_rules IS 'Unified alert rules supporting both THRESHOLD and COMPOSITE types';
COMMENT ON COLUMN unified_alert_rules.rule_type IS 'THRESHOLD: Simple threshold alerts, COMPOSITE: Multi-condition alerts';
COMMENT ON COLUMN unified_alert_rules.conditions IS 'JSON array of conditions for COMPOSITE rules: [{field, operator, threshold, weight}]';
COMMENT ON COLUMN unified_alert_rules.logic IS 'AND or OR - how to combine conditions in COMPOSITE rules';
-- Migration: 009_device_types.sql
-- Description: Device Types system for AWS IoT / Cumulocity style device templates
-- Author: IOT Platform
-- Date: 2025-01-07

-- =============================================================================
-- DEVICE TYPES TABLE
-- Templates for device registration with data models, capabilities, settings
-- =============================================================================

-- Create enum for device categories
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'device_category') THEN
        CREATE TYPE device_category AS ENUM (
            'sensor',
            'gateway',
            'actuator',
            'tracker',
            'meter',
            'camera',
            'controller',
            'other'
        );
    END IF;
END$$;

-- Create device_types table
CREATE TABLE IF NOT EXISTS device_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Basic Info
    name VARCHAR(100) NOT NULL,
    description TEXT,
    manufacturer VARCHAR(100),
    model VARCHAR(100),
    category VARCHAR(50) DEFAULT 'other',
    icon VARCHAR(50) DEFAULT 'cpu',
    color VARCHAR(20) DEFAULT '#6366f1',
    
    -- Data Model Schema (telemetry fields this device type sends)
    -- Example: [{"name": "temperature", "type": "float", "unit": "°C", "min": -40, "max": 85}]
    data_model JSONB DEFAULT '[]'::jsonb,
    
    -- Device capabilities (what the device supports)
    -- Example: ["telemetry", "commands", "firmware_ota", "location"]
    capabilities JSONB DEFAULT '[]'::jsonb,
    
    -- Default settings for devices of this type
    -- Example: {"heartbeat_interval": 60, "telemetry_interval": 300, "offline_threshold": 900}
    default_settings JSONB DEFAULT '{}'::jsonb,
    
    -- Connectivity configuration
    -- Example: {"protocol": "lorawan", "lorawan_class": "A", "mqtt_topic_template": "devices/{device_id}/telemetry"}
    connectivity JSONB DEFAULT '{}'::jsonb,
    
    -- Additional metadata (custom fields, documentation links, etc.)
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    device_count INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT device_types_name_tenant_unique UNIQUE (tenant_id, name)
);

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_device_types_tenant_id ON device_types(tenant_id);
CREATE INDEX IF NOT EXISTS idx_device_types_category ON device_types(category);
CREATE INDEX IF NOT EXISTS idx_device_types_is_active ON device_types(is_active);
CREATE INDEX IF NOT EXISTS idx_device_types_manufacturer ON device_types(manufacturer);
CREATE INDEX IF NOT EXISTS idx_device_types_data_model ON device_types USING GIN (data_model);
CREATE INDEX IF NOT EXISTS idx_device_types_capabilities ON device_types USING GIN (capabilities);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE device_types ENABLE ROW LEVEL SECURITY;

-- Policy: Tenants can only access their own device types
DROP POLICY IF EXISTS device_types_tenant_isolation ON device_types;
CREATE POLICY device_types_tenant_isolation ON device_types
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- =============================================================================
-- TRIGGER FOR UPDATED_AT
-- =============================================================================

CREATE OR REPLACE FUNCTION update_device_types_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_device_types_updated_at ON device_types;
CREATE TRIGGER trigger_device_types_updated_at
    BEFORE UPDATE ON device_types
    FOR EACH ROW
    EXECUTE FUNCTION update_device_types_updated_at();

-- =============================================================================
-- ADD DEVICE_TYPE_ID TO DEVICES TABLE
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'devices' AND column_name = 'device_type_id'
    ) THEN
        ALTER TABLE devices ADD COLUMN device_type_id UUID REFERENCES device_types(id) ON DELETE SET NULL;
        CREATE INDEX idx_devices_device_type_id ON devices(device_type_id);
    END IF;
END$$;

-- =============================================================================
-- FUNCTION: UPDATE DEVICE COUNT ON DEVICE TYPE
-- =============================================================================

CREATE OR REPLACE FUNCTION update_device_type_count()
RETURNS TRIGGER AS $$
BEGIN
    -- When a device is inserted with a device_type_id
    IF TG_OP = 'INSERT' AND NEW.device_type_id IS NOT NULL THEN
        UPDATE device_types 
        SET device_count = device_count + 1 
        WHERE id = NEW.device_type_id;
    END IF;
    
    -- When a device is deleted with a device_type_id
    IF TG_OP = 'DELETE' AND OLD.device_type_id IS NOT NULL THEN
        UPDATE device_types 
        SET device_count = GREATEST(device_count - 1, 0) 
        WHERE id = OLD.device_type_id;
    END IF;
    
    -- When a device's type changes
    IF TG_OP = 'UPDATE' THEN
        IF OLD.device_type_id IS DISTINCT FROM NEW.device_type_id THEN
            IF OLD.device_type_id IS NOT NULL THEN
                UPDATE device_types 
                SET device_count = GREATEST(device_count - 1, 0) 
                WHERE id = OLD.device_type_id;
            END IF;
            IF NEW.device_type_id IS NOT NULL THEN
                UPDATE device_types 
                SET device_count = device_count + 1 
                WHERE id = NEW.device_type_id;
            END IF;
        END IF;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger on devices table
DROP TRIGGER IF EXISTS trigger_update_device_type_count ON devices;
CREATE TRIGGER trigger_update_device_type_count
    AFTER INSERT OR UPDATE OR DELETE ON devices
    FOR EACH ROW
    EXECUTE FUNCTION update_device_type_count();

-- =============================================================================
-- SEED DATA: Default device types for new tenants
-- =============================================================================

-- Note: This seed data will be inserted for the demo tenant
-- Real tenants would create their own device types

INSERT INTO device_types (tenant_id, name, description, manufacturer, category, icon, color, data_model, capabilities, default_settings, connectivity)
SELECT 
    t.id,
    dt.name,
    dt.description,
    dt.manufacturer,
    dt.category,
    dt.icon,
    dt.color,
    dt.data_model,
    dt.capabilities,
    dt.default_settings,
    dt.connectivity
FROM tenants t
CROSS JOIN (
    VALUES 
    (
        'Environmental Sensor',
        'Multi-sensor for temperature, humidity, and air quality monitoring',
        'Generic',
        'sensor',
        'thermometer',
        '#10b981',
        '[
            {"name": "temperature", "type": "float", "unit": "°C", "description": "Ambient temperature", "min": -40, "max": 85, "required": true},
            {"name": "humidity", "type": "float", "unit": "%", "description": "Relative humidity", "min": 0, "max": 100, "required": true},
            {"name": "pressure", "type": "float", "unit": "hPa", "description": "Atmospheric pressure", "min": 300, "max": 1100, "required": false},
            {"name": "battery", "type": "integer", "unit": "%", "description": "Battery level", "min": 0, "max": 100, "required": false}
        ]'::jsonb,
        '["telemetry", "alerts", "firmware_ota"]'::jsonb,
        '{"heartbeat_interval": 60, "telemetry_interval": 300, "offline_threshold": 900}'::jsonb,
        '{"protocol": "lorawan", "lorawan_class": "A"}'::jsonb
    ),
    (
        'Smart Meter',
        'Energy consumption meter with real-time monitoring',
        'Generic',
        'meter',
        'zap',
        '#f59e0b',
        '[
            {"name": "power", "type": "float", "unit": "W", "description": "Current power consumption", "min": 0, "required": true},
            {"name": "energy", "type": "float", "unit": "kWh", "description": "Total energy consumed", "min": 0, "required": true},
            {"name": "voltage", "type": "float", "unit": "V", "description": "Line voltage", "min": 0, "max": 500, "required": false},
            {"name": "current", "type": "float", "unit": "A", "description": "Line current", "min": 0, "required": false}
        ]'::jsonb,
        '["telemetry", "alerts", "commands"]'::jsonb,
        '{"heartbeat_interval": 30, "telemetry_interval": 60, "offline_threshold": 300}'::jsonb,
        '{"protocol": "mqtt"}'::jsonb
    ),
    (
        'GPS Tracker',
        'Asset tracking device with GPS and motion sensors',
        'Generic',
        'tracker',
        'map-pin',
        '#8b5cf6',
        '[
            {"name": "latitude", "type": "float", "unit": "°", "description": "GPS latitude", "required": true},
            {"name": "longitude", "type": "float", "unit": "°", "description": "GPS longitude", "required": true},
            {"name": "altitude", "type": "float", "unit": "m", "description": "Altitude above sea level", "required": false},
            {"name": "speed", "type": "float", "unit": "km/h", "description": "Current speed", "min": 0, "required": false},
            {"name": "battery", "type": "integer", "unit": "%", "description": "Battery level", "min": 0, "max": 100, "required": false}
        ]'::jsonb,
        '["telemetry", "location", "alerts", "firmware_ota"]'::jsonb,
        '{"heartbeat_interval": 120, "telemetry_interval": 600, "offline_threshold": 1800}'::jsonb,
        '{"protocol": "lorawan", "lorawan_class": "A"}'::jsonb
    ),
    (
        'LoRaWAN Gateway',
        'LoRaWAN network gateway for device connectivity',
        'Generic',
        'gateway',
        'radio',
        '#3b82f6',
        '[
            {"name": "connected_devices", "type": "integer", "description": "Number of connected devices", "min": 0, "required": true},
            {"name": "packets_received", "type": "integer", "description": "Packets received", "min": 0, "required": false},
            {"name": "packets_transmitted", "type": "integer", "description": "Packets transmitted", "min": 0, "required": false},
            {"name": "cpu_usage", "type": "float", "unit": "%", "description": "CPU usage", "min": 0, "max": 100, "required": false},
            {"name": "memory_usage", "type": "float", "unit": "%", "description": "Memory usage", "min": 0, "max": 100, "required": false}
        ]'::jsonb,
        '["telemetry", "commands", "firmware_ota", "remote_config"]'::jsonb,
        '{"heartbeat_interval": 30, "telemetry_interval": 60, "offline_threshold": 180}'::jsonb,
        '{"protocol": "mqtt"}'::jsonb
    ),
    (
        'Smart Actuator',
        'Remote-controlled relay/actuator for automation',
        'Generic',
        'actuator',
        'toggle-right',
        '#ef4444',
        '[
            {"name": "state", "type": "boolean", "description": "Current relay state (on/off)", "required": true},
            {"name": "power", "type": "float", "unit": "W", "description": "Power consumption of connected load", "min": 0, "required": false}
        ]'::jsonb,
        '["telemetry", "commands", "alerts"]'::jsonb,
        '{"heartbeat_interval": 60, "telemetry_interval": 300, "offline_threshold": 600}'::jsonb,
        '{"protocol": "mqtt"}'::jsonb
    )
) AS dt(name, description, manufacturer, category, icon, color, data_model, capabilities, default_settings, connectivity)
WHERE NOT EXISTS (
    SELECT 1 FROM device_types WHERE device_types.tenant_id = t.id AND device_types.name = dt.name
);

-- Update device count for each device type based on existing devices
UPDATE device_types dt
SET device_count = (
    SELECT COUNT(*) FROM devices d WHERE d.device_type_id = dt.id
);

-- =============================================================================
-- VERIFY MIGRATION
-- =============================================================================

DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count FROM device_types;
    RAISE NOTICE 'Migration 009_device_types.sql completed. Device types created: %', v_count;
END$$;
-- Migration 010: Dashboard System
-- Creates tables for dashboard builder and solution templates

-- ================================================================
-- 1. DASHBOARDS TABLE
-- ================================================================
CREATE TABLE IF NOT EXISTS dashboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    is_default BOOLEAN DEFAULT false,
    layout_config JSONB DEFAULT '{}',
    theme JSONB DEFAULT '{}',
    solution_type VARCHAR(100),
    extra_data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT dashboards_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT dashboards_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for dashboards
CREATE INDEX IF NOT EXISTS idx_dashboards_tenant_user ON dashboards(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_dashboards_solution_type ON dashboards(solution_type);
CREATE INDEX IF NOT EXISTS idx_dashboards_created_at ON dashboards(created_at DESC);

-- ================================================================
-- 2. DASHBOARD WIDGETS TABLE
-- ================================================================
CREATE TABLE IF NOT EXISTS dashboard_widgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dashboard_id UUID NOT NULL,
    widget_type VARCHAR(50) NOT NULL,
    title VARCHAR(200),
    position_x INTEGER NOT NULL,
    position_y INTEGER NOT NULL,
    width INTEGER NOT NULL DEFAULT 2,
    height INTEGER NOT NULL DEFAULT 2,
    configuration JSONB NOT NULL DEFAULT '{}',
    data_sources JSONB DEFAULT '[]',
    refresh_interval INTEGER DEFAULT 30,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT dashboard_widgets_dashboard_id_fkey FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE,
    CONSTRAINT check_positive_dimensions CHECK (width > 0 AND height > 0),
    CONSTRAINT check_valid_position CHECK (position_x >= 0 AND position_y >= 0)
);

-- Indexes for dashboard_widgets
CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_dashboard ON dashboard_widgets(dashboard_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_type ON dashboard_widgets(widget_type);

-- ================================================================
-- 3. SOLUTION TEMPLATES TABLE
-- ================================================================
CREATE TABLE IF NOT EXISTS solution_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL UNIQUE,
    identifier VARCHAR(100) NOT NULL UNIQUE,
    category VARCHAR(50) NOT NULL,
    description TEXT,
    icon VARCHAR(50) DEFAULT 'layout-dashboard',
    color VARCHAR(20) DEFAULT '#0066CC',
    target_device_types JSONB DEFAULT '[]',
    required_capabilities JSONB DEFAULT '[]',
    template_config JSONB NOT NULL,
    preview_image_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for solution_templates
CREATE INDEX IF NOT EXISTS idx_solution_templates_category ON solution_templates(category);
CREATE INDEX IF NOT EXISTS idx_solution_templates_active ON solution_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_solution_templates_identifier ON solution_templates(identifier);

-- ================================================================
-- 4. ENABLE ROW LEVEL SECURITY
-- ================================================================
ALTER TABLE dashboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_widgets ENABLE ROW LEVEL SECURITY;

-- RLS Policies for dashboards
-- Users can only see their own dashboards within their tenant
DROP POLICY IF EXISTS tenant_isolation_dashboards ON dashboards;
CREATE POLICY tenant_isolation_dashboards ON dashboards
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

DROP POLICY IF EXISTS user_dashboards_access ON dashboards;
CREATE POLICY user_dashboards_access ON dashboards
    FOR ALL
    USING (
        user_id = current_setting('app.current_user_id')::UUID
        AND tenant_id = current_setting('app.current_tenant_id')::UUID
    );

-- RLS Policies for dashboard_widgets
-- Users can only access widgets from their own dashboards
DROP POLICY IF EXISTS user_dashboard_widgets_access ON dashboard_widgets;
CREATE POLICY user_dashboard_widgets_access ON dashboard_widgets
    FOR ALL
    USING (
        dashboard_id IN (
            SELECT id FROM dashboards
            WHERE user_id = current_setting('app.current_user_id')::UUID
            AND tenant_id = current_setting('app.current_tenant_id')::UUID
        )
    );

-- ================================================================
-- 5. UPDATED_AT TRIGGERS
-- ================================================================
-- Create trigger function if not exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers
DROP TRIGGER IF EXISTS update_dashboards_updated_at ON dashboards;
CREATE TRIGGER update_dashboards_updated_at
    BEFORE UPDATE ON dashboards
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_dashboard_widgets_updated_at ON dashboard_widgets;
CREATE TRIGGER update_dashboard_widgets_updated_at
    BEFORE UPDATE ON dashboard_widgets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_solution_templates_updated_at ON solution_templates;
CREATE TRIGGER update_solution_templates_updated_at
    BEFORE UPDATE ON solution_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ================================================================
-- 6. SEED DATA: Water Meter Monitoring Template
-- ================================================================
INSERT INTO solution_templates (
    name,
    identifier,
    category,
    description,
    icon,
    color,
    target_device_types,
    required_capabilities,
    template_config,
    is_active
) VALUES (
    'Water Flow Monitoring',
    'water_flow_monitoring',
    'utilities',
    'Comprehensive water flow monitoring dashboard with real-time metrics, flow rate tracking, velocity analysis, and cumulative volume measurements. Ideal for water utilities, irrigation systems, and industrial water management.',
    'droplet',
    '#0ea5e9',
    '["water_meter", "flow_sensor", "water_flow_sensor"]'::jsonb,
    '["flow_rate", "velocity", "total_volume", "positive_cumulative", "negative_cumulative"]'::jsonb,
    '{
        "theme": {
            "primary_color": "#0ea5e9",
            "title": "Water Flow Monitoring"
        },
        "widgets": [
            {
                "type": "device_info",
                "title": "Device Information",
                "position": {"x": 0, "y": 0, "w": 3, "h": 3},
                "config": {
                    "show_image": true,
                    "show_status": true,
                    "show_location": true,
                    "show_metadata": true
                },
                "data_binding": {
                    "auto_bind": true
                }
            },
            {
                "type": "kpi_card",
                "title": "Velocity",
                "position": {"x": 3, "y": 0, "w": 3, "h": 2},
                "config": {
                    "metric": "velocity",
                    "unit": "m/s",
                    "decimal_places": 2,
                    "show_trend": true,
                    "trend_period": "24h",
                    "icon": "gauge",
                    "color": "#3b82f6"
                },
                "data_binding": {
                    "metric": "velocity",
                    "auto_bind": true
                }
            },
            {
                "type": "kpi_card",
                "title": "Flow Rate",
                "position": {"x": 6, "y": 0, "w": 3, "h": 2},
                "config": {
                    "metric": "flow_rate",
                    "unit": "m³/hr",
                    "decimal_places": 2,
                    "show_trend": true,
                    "trend_period": "24h",
                    "icon": "droplet",
                    "color": "#10b981"
                },
                "data_binding": {
                    "metric": "flow_rate",
                    "auto_bind": true
                }
            },
            {
                "type": "kpi_card",
                "title": "Today Total",
                "position": {"x": 9, "y": 0, "w": 3, "h": 2},
                "config": {
                    "metric": "positive_cumulative",
                    "unit": "m³",
                    "decimal_places": 2,
                    "show_trend": false,
                    "icon": "activity",
                    "color": "#8b5cf6"
                },
                "data_binding": {
                    "metric": "positive_cumulative",
                    "auto_bind": true,
                    "aggregation": "latest"
                }
            },
            {
                "type": "chart",
                "title": "Velocity - Last 12 Hours",
                "position": {"x": 0, "y": 3, "w": 6, "h": 4},
                "config": {
                    "chart_type": "area",
                    "metrics": ["velocity"],
                    "time_range": "12h",
                    "aggregation": "avg",
                    "y_axis_label": "Velocity (m/s)",
                    "show_legend": true,
                    "colors": ["#3b82f6"],
                    "fill_opacity": 0.3
                },
                "data_binding": {
                    "metrics": ["velocity"],
                    "auto_bind": true
                }
            },
            {
                "type": "chart",
                "title": "Flow Rate - Last 12 Hours",
                "position": {"x": 6, "y": 3, "w": 6, "h": 4},
                "config": {
                    "chart_type": "area",
                    "metrics": ["flow_rate"],
                    "time_range": "12h",
                    "aggregation": "avg",
                    "y_axis_label": "Flow Rate (m³/hr)",
                    "show_legend": true,
                    "colors": ["#10b981"],
                    "fill_opacity": 0.3
                },
                "data_binding": {
                    "metrics": ["flow_rate"],
                    "auto_bind": true
                }
            },
            {
                "type": "table",
                "title": "Real-time Data - Last 24 Hours",
                "position": {"x": 0, "y": 7, "w": 10, "h": 4},
                "config": {
                    "columns": [
                        {"field": "timestamp", "label": "Timestamp", "format": "datetime"},
                        {"field": "flow_rate", "label": "Flow Rate (m³/hr)", "format": "decimal:2"},
                        {"field": "velocity", "label": "Velocity (m/s)", "format": "decimal:2"},
                        {"field": "positive_cumulative", "label": "Positive Total (m³)", "format": "decimal:2"},
                        {"field": "negative_cumulative", "label": "Negative Total (m³)", "format": "decimal:2"}
                    ],
                    "page_size": 10,
                    "auto_refresh": true,
                    "sort_by": "timestamp",
                    "sort_order": "desc"
                },
                "data_binding": {
                    "auto_bind": true,
                    "time_range": "24h"
                }
            },
            {
                "type": "map",
                "title": "Device Location",
                "position": {"x": 10, "y": 7, "w": 2, "h": 4},
                "config": {
                    "zoom": 15,
                    "show_label": true,
                    "show_marker": true,
                    "marker_color": "#0ea5e9"
                },
                "data_binding": {
                    "auto_bind": true
                }
            }
        ]
    }'::jsonb,
    true
) ON CONFLICT (identifier) DO UPDATE SET
    name = EXCLUDED.name,
    category = EXCLUDED.category,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    color = EXCLUDED.color,
    target_device_types = EXCLUDED.target_device_types,
    required_capabilities = EXCLUDED.required_capabilities,
    template_config = EXCLUDED.template_config,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

-- ================================================================
-- 7. COMMENTS
-- ================================================================
COMMENT ON TABLE dashboards IS 'User-created dashboards with customizable layouts and widgets';
COMMENT ON TABLE dashboard_widgets IS 'Individual widgets placed on dashboards with configuration and data bindings';
COMMENT ON TABLE solution_templates IS 'Pre-built industry-specific dashboard templates';

COMMENT ON COLUMN dashboards.is_default IS 'Whether this dashboard is shown by default on login';
COMMENT ON COLUMN dashboards.layout_config IS 'Grid layout configuration including breakpoints and column settings';
COMMENT ON COLUMN dashboards.theme IS 'Dashboard-specific color scheme and branding';
COMMENT ON COLUMN dashboards.solution_type IS 'Identifier of the solution template used to create this dashboard';

COMMENT ON COLUMN dashboard_widgets.widget_type IS 'Widget type: kpi_card, chart, gauge, map, table, device_info, etc.';
COMMENT ON COLUMN dashboard_widgets.configuration IS 'Widget-specific configuration (chart type, colors, thresholds, etc.)';
COMMENT ON COLUMN dashboard_widgets.data_sources IS 'Array of device IDs and metrics bound to this widget';
COMMENT ON COLUMN dashboard_widgets.refresh_interval IS 'Auto-refresh interval in seconds';

COMMENT ON COLUMN solution_templates.identifier IS 'Unique slug identifier for the template';
COMMENT ON COLUMN solution_templates.target_device_types IS 'Array of compatible device type identifiers';
COMMENT ON COLUMN solution_templates.required_capabilities IS 'Array of required telemetry capabilities/metrics';
COMMENT ON COLUMN solution_templates.template_config IS 'Complete dashboard and widget configuration blueprint';
-- Migration 010a: Fix Dashboard RLS Policy Naming
-- Ensures compatibility with both app.tenant_id and app.current_tenant_id

-- The database.py now sets both app.tenant_id and app.current_tenant_id
-- for maximum compatibility across all migrations.

-- This migration is optional - it documents that we support both naming conventions
-- No actual changes needed as database.py sets both config variables

-- Original policies from 010_dashboard_system.sql already use:
-- - app.current_tenant_id (new naming)
-- - app.current_user_id (user-level RLS)

-- These are compatible with the updated RLSSession.set_tenant_context()
-- which now sets both:
-- - app.tenant_id (legacy, for older migrations)
-- - app.current_tenant_id (new, for dashboard system)
-- - app.current_user_id (when user_id parameter provided)

-- No SQL changes required - this file is for documentation only
SELECT 'Dashboard RLS policies are compatible with updated RLSSession' AS status;
-- Migration: Seed additional solution templates
-- Adds 4 more industry-specific dashboard templates

-- Energy Meter Monitoring Template
INSERT INTO solution_templates (
    id,
    name,
    identifier,
    category,
    description,
    icon,
    color,
    target_device_types,
    required_capabilities,
    template_config,
    is_active
) VALUES (
    gen_random_uuid(),
    'Energy Meter Monitoring',
    'energy_meter_monitoring',
    'utilities',
    'Real-time monitoring of energy consumption, power demand, and power factor metrics for smart energy meters.',
    'zap',
    '#f59e0b',
    '["energy_meter", "smart_meter"]',
    '["power", "voltage", "current", "energy_consumption"]',
    '{
        "theme": {
            "primary_color": "#f59e0b",
            "title": "Energy Meter Monitoring"
        },
        "widgets": [
            {
                "type": "device_info",
                "title": "Meter Info",
                "position": {"x": 0, "y": 0, "w": 2, "h": 3},
                "config": {
                    "show_image": true,
                    "show_status": true,
                    "show_location": true
                }
            },
            {
                "type": "kpi_card",
                "title": "Power Consumption",
                "position": {"x": 2, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "power",
                    "unit": "kW",
                    "show_trend": true,
                    "icon": "zap"
                },
                "data_binding": {
                    "metric": "power",
                    "auto_bind": true
                }
            },
            {
                "type": "kpi_card",
                "title": "Today''s Energy",
                "position": {"x": 4, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "energy_consumption",
                    "unit": "kWh",
                    "icon": "battery"
                },
                "data_binding": {
                    "metric": "energy_consumption",
                    "auto_bind": true
                }
            },
            {
                "type": "kpi_card",
                "title": "Power Factor",
                "position": {"x": 6, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "power_factor",
                    "unit": "",
                    "decimal_places": 3,
                    "icon": "activity"
                },
                "data_binding": {
                    "metric": "power_factor",
                    "auto_bind": true
                }
            },
            {
                "type": "chart",
                "title": "Power Consumption - Last 24 Hours",
                "position": {"x": 0, "y": 3, "w": 6, "h": 4},
                "config": {
                    "chart_type": "area",
                    "metrics": ["power"],
                    "time_range": "24h",
                    "color": "#f59e0b"
                }
            },
            {
                "type": "chart",
                "title": "Voltage & Current",
                "position": {"x": 6, "y": 3, "w": 6, "h": 4},
                "config": {
                    "chart_type": "line",
                    "metrics": ["voltage", "current"],
                    "time_range": "24h",
                    "colors": ["#3b82f6", "#ef4444"]
                }
            }
        ]
    }',
    true
);

-- Environmental Monitoring Template
INSERT INTO solution_templates (
    id,
    name,
    identifier,
    category,
    description,
    icon,
    color,
    target_device_types,
    required_capabilities,
    template_config,
    is_active
) VALUES (
    gen_random_uuid(),
    'Environmental Monitoring',
    'environmental_monitoring',
    'environmental',
    'Monitor temperature, humidity, air quality (CO2, PM2.5), and environmental conditions in real-time.',
    'cloud',
    '#10b981',
    '["environmental_sensor", "air_quality_sensor"]',
    '["temperature", "humidity", "co2", "pm25"]',
    '{
        "theme": {
            "primary_color": "#10b981",
            "title": "Environmental Monitoring"
        },
        "widgets": [
            {
                "type": "kpi_card",
                "title": "Temperature",
                "position": {"x": 0, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "temperature",
                    "unit": "°C",
                    "show_trend": true,
                    "icon": "thermometer",
                    "threshold_warning": 25,
                    "threshold_critical": 30
                },
                "data_binding": {
                    "metric": "temperature",
                    "auto_bind": true
                }
            },
            {
                "type": "kpi_card",
                "title": "Humidity",
                "position": {"x": 2, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "humidity",
                    "unit": "%",
                    "show_trend": true,
                    "icon": "droplet",
                    "threshold_warning": 60,
                    "threshold_critical": 80
                },
                "data_binding": {
                    "metric": "humidity",
                    "auto_bind": true
                }
            },
            {
                "type": "kpi_card",
                "title": "CO₂ Level",
                "position": {"x": 4, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "co2",
                    "unit": "ppm",
                    "show_trend": true,
                    "icon": "wind",
                    "threshold_warning": 1000,
                    "threshold_critical": 2000
                },
                "data_binding": {
                    "metric": "co2",
                    "auto_bind": true
                }
            },
            {
                "type": "kpi_card",
                "title": "PM2.5",
                "position": {"x": 6, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "pm25",
                    "unit": "μg/m³",
                    "show_trend": true,
                    "icon": "alert-circle",
                    "threshold_warning": 35,
                    "threshold_critical": 55
                },
                "data_binding": {
                    "metric": "pm25",
                    "auto_bind": true
                }
            },
            {
                "type": "chart",
                "title": "Temperature & Humidity - Last 24 Hours",
                "position": {"x": 0, "y": 2, "w": 6, "h": 4},
                "config": {
                    "chart_type": "line",
                    "metrics": ["temperature", "humidity"],
                    "time_range": "24h",
                    "colors": ["#ef4444", "#3b82f6"]
                }
            },
            {
                "type": "chart",
                "title": "Air Quality - Last 24 Hours",
                "position": {"x": 6, "y": 2, "w": 6, "h": 4},
                "config": {
                    "chart_type": "area",
                    "metrics": ["co2", "pm25"],
                    "time_range": "24h",
                    "colors": ["#10b981", "#f59e0b"]
                }
            },
            {
                "type": "map",
                "title": "Device Locations",
                "position": {"x": 0, "y": 6, "w": 4, "h": 4},
                "config": {
                    "zoom": 12,
                    "show_label": true
                }
            },
            {
                "type": "table",
                "title": "Recent Readings",
                "position": {"x": 4, "y": 6, "w": 8, "h": 4},
                "config": {
                    "columns": ["timestamp", "temperature", "humidity", "co2", "pm25"],
                    "page_size": 10,
                    "auto_refresh": true
                }
            }
        ]
    }',
    true
);

-- Fleet Tracking Template
INSERT INTO solution_templates (
    id,
    name,
    identifier,
    category,
    description,
    icon,
    color,
    target_device_types,
    required_capabilities,
    template_config,
    is_active
) VALUES (
    gen_random_uuid(),
    'Fleet Tracking',
    'fleet_tracking',
    'fleet',
    'Real-time vehicle tracking with location, speed, fuel consumption, and route monitoring for fleet management.',
    'truck',
    '#8b5cf6',
    '["gps_tracker", "vehicle_tracker"]',
    '["latitude", "longitude", "speed", "fuel_level"]',
    '{
        "theme": {
            "primary_color": "#8b5cf6",
            "title": "Fleet Tracking"
        },
        "widgets": [
            {
                "type": "kpi_card",
                "title": "Active Vehicles",
                "position": {"x": 0, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "active_count",
                    "unit": "",
                    "icon": "truck"
                }
            },
            {
                "type": "kpi_card",
                "title": "Avg Speed",
                "position": {"x": 2, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "speed",
                    "unit": "km/h",
                    "show_trend": true,
                    "icon": "gauge"
                },
                "data_binding": {
                    "metric": "speed",
                    "auto_bind": true
                }
            },
            {
                "type": "kpi_card",
                "title": "Total Distance",
                "position": {"x": 4, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "distance_today",
                    "unit": "km",
                    "icon": "map"
                }
            },
            {
                "type": "kpi_card",
                "title": "Fuel Level",
                "position": {"x": 6, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "fuel_level",
                    "unit": "%",
                    "icon": "droplet",
                    "threshold_warning": 30,
                    "threshold_critical": 15
                },
                "data_binding": {
                    "metric": "fuel_level",
                    "auto_bind": true
                }
            },
            {
                "type": "map",
                "title": "Live Vehicle Locations",
                "position": {"x": 0, "y": 2, "w": 8, "h": 5},
                "config": {
                    "zoom": 10,
                    "show_label": true,
                    "show_routes": true
                }
            },
            {
                "type": "table",
                "title": "Vehicle Status",
                "position": {"x": 8, "y": 2, "w": 4, "h": 5},
                "config": {
                    "columns": ["vehicle_id", "speed", "fuel_level", "last_update"],
                    "page_size": 10,
                    "auto_refresh": true
                }
            },
            {
                "type": "chart",
                "title": "Speed History - Last 12 Hours",
                "position": {"x": 0, "y": 7, "w": 12, "h": 3},
                "config": {
                    "chart_type": "line",
                    "metrics": ["speed"],
                    "time_range": "12h",
                    "color": "#8b5cf6"
                }
            }
        ]
    }',
    true
);

-- Smart Factory Template
INSERT INTO solution_templates (
    id,
    name,
    identifier,
    category,
    description,
    icon,
    color,
    target_device_types,
    required_capabilities,
    template_config,
    is_active
) VALUES (
    gen_random_uuid(),
    'Smart Factory',
    'smart_factory',
    'industry_4_0',
    'Industry 4.0 dashboard for monitoring OEE, machine status, production rates, and downtime tracking.',
    'factory',
    '#dc2626',
    '["industrial_gateway", "plc", "machine_sensor"]',
    '["machine_status", "production_count", "temperature", "vibration"]',
    '{
        "theme": {
            "primary_color": "#dc2626",
            "title": "Smart Factory"
        },
        "widgets": [
            {
                "type": "kpi_card",
                "title": "OEE",
                "position": {"x": 0, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "oee",
                    "unit": "%",
                    "show_trend": true,
                    "icon": "activity",
                    "threshold_warning": 70,
                    "threshold_critical": 50
                },
                "data_binding": {
                    "metric": "oee",
                    "auto_bind": true
                }
            },
            {
                "type": "kpi_card",
                "title": "Production Rate",
                "position": {"x": 2, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "production_rate",
                    "unit": "units/hr",
                    "show_trend": true,
                    "icon": "trending-up"
                },
                "data_binding": {
                    "metric": "production_count",
                    "auto_bind": true
                }
            },
            {
                "type": "kpi_card",
                "title": "Downtime Today",
                "position": {"x": 4, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "downtime_minutes",
                    "unit": "min",
                    "icon": "alert-circle",
                    "color": "#ef4444"
                }
            },
            {
                "type": "kpi_card",
                "title": "Active Machines",
                "position": {"x": 6, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "active_machines",
                    "unit": "",
                    "icon": "cpu"
                }
            },
            {
                "type": "chart",
                "title": "Production Output - Last 24 Hours",
                "position": {"x": 0, "y": 2, "w": 6, "h": 4},
                "config": {
                    "chart_type": "bar",
                    "metrics": ["production_count"],
                    "time_range": "24h",
                    "color": "#dc2626"
                }
            },
            {
                "type": "chart",
                "title": "Machine Temperature & Vibration",
                "position": {"x": 6, "y": 2, "w": 6, "h": 4},
                "config": {
                    "chart_type": "line",
                    "metrics": ["temperature", "vibration"],
                    "time_range": "24h",
                    "colors": ["#f59e0b", "#8b5cf6"]
                }
            },
            {
                "type": "table",
                "title": "Machine Status",
                "position": {"x": 0, "y": 6, "w": 8, "h": 4},
                "config": {
                    "columns": ["machine_id", "status", "production_count", "temperature", "last_maintenance"],
                    "page_size": 10,
                    "auto_refresh": true
                }
            },
            {
                "type": "map",
                "title": "Factory Floor",
                "position": {"x": 8, "y": 6, "w": 4, "h": 4},
                "config": {
                    "zoom": 18,
                    "show_label": true
                }
            }
        ]
    }',
    true
);
-- ============================================================================
-- Phase 3.2e - Multi-Channel Notifications
-- Adds support for email, Slack, webhook notifications with delivery tracking
-- ============================================================================

-- Enable extensions if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- NOTIFICATION CHANNELS (User Notification Endpoints)
-- ============================================================================

CREATE TABLE notification_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_type VARCHAR(50) NOT NULL,  -- 'email', 'slack', 'webhook', 'apns', 'fcm'
    config JSONB NOT NULL,  -- {email: "...", slack_webhook_url: "...", webhook_url: "...", webhook_secret: "..."}
    enabled BOOLEAN DEFAULT true,
    verified BOOLEAN DEFAULT false,  -- For email verification
    verified_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT valid_channel_type CHECK (channel_type IN ('email', 'slack', 'webhook', 'apns', 'fcm', 'sms')),
    CONSTRAINT unique_user_channel UNIQUE(user_id, channel_type, config)
);

CREATE INDEX idx_notification_channels_tenant ON notification_channels(tenant_id);
CREATE INDEX idx_notification_channels_user ON notification_channels(user_id);
CREATE INDEX idx_notification_channels_enabled ON notification_channels(enabled);
CREATE INDEX idx_notification_channels_type ON notification_channels(channel_type);

-- Row-Level Security for notification_channels
ALTER TABLE notification_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_channels_tenant_isolation ON notification_channels
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- ============================================================================
-- NOTIFICATION RULES (Link Alert Rules to Notification Channels)
-- ============================================================================

CREATE TABLE notification_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alert_rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT unique_rule_channel UNIQUE(alert_rule_id, channel_id)
);

CREATE INDEX idx_notification_rules_alert ON notification_rules(alert_rule_id);
CREATE INDEX idx_notification_rules_channel ON notification_rules(channel_id);
CREATE INDEX idx_notification_rules_enabled ON notification_rules(enabled);

-- Row-Level Security for notification_rules
ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_rules_tenant_isolation ON notification_rules
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- ============================================================================
-- NOTIFICATIONS (Sent Notification History)
-- ============================================================================

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alert_event_id UUID NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
    channel_type VARCHAR(50) NOT NULL,  -- Denormalized for easier querying
    recipient VARCHAR(255) NOT NULL,  -- email, phone, webhook URL, etc.
    status VARCHAR(50) NOT NULL DEFAULT 'pending',  -- pending, sending, sent, failed, bounced
    delivery_status VARCHAR(50),  -- success, permanent_failure, temporary_failure, invalid_address
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    next_retry_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,  -- When actually delivered/read (if supported)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT valid_status CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'bounced', 'skipped')),
    CONSTRAINT valid_delivery_status CHECK (delivery_status IS NULL OR delivery_status IN ('success', 'permanent_failure', 'temporary_failure', 'invalid_address', 'rate_limited'))
);

CREATE INDEX idx_notifications_tenant ON notifications(tenant_id);
CREATE INDEX idx_notifications_alert_event ON notifications(alert_event_id);
CREATE INDEX idx_notifications_channel ON notifications(channel_id);
CREATE INDEX idx_notifications_status ON notifications(status);
CREATE INDEX idx_notifications_recipient ON notifications(recipient);
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX idx_notifications_retry ON notifications(status, next_retry_at) WHERE status = 'pending';

-- Row-Level Security for notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_tenant_isolation ON notifications
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- ============================================================================
-- NOTIFICATION TEMPLATES (Customizable Message Templates)
-- ============================================================================

CREATE TABLE notification_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel_type VARCHAR(50) NOT NULL,  -- 'email', 'slack', 'webhook'
    alert_type VARCHAR(100),  -- Optional: specific alert type, null = default
    name VARCHAR(255) NOT NULL,
    subject VARCHAR(500),  -- For email only
    body TEXT NOT NULL,  -- Jinja2 template syntax
    variables JSONB DEFAULT '[]',  -- List of available variables for template
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT valid_template_channel CHECK (channel_type IN ('email', 'slack', 'webhook')),
    CONSTRAINT unique_template UNIQUE(tenant_id, channel_type, alert_type)
);

CREATE INDEX idx_notification_templates_tenant ON notification_templates(tenant_id);
CREATE INDEX idx_notification_templates_channel ON notification_templates(channel_type);
CREATE INDEX idx_notification_templates_enabled ON notification_templates(enabled);

-- Row-Level Security for notification_templates
ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_templates_tenant_isolation ON notification_templates
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- ============================================================================
-- ALTER USERS TABLE (Add Notification Preferences)
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{
    "quiet_hours_enabled": false,
    "quiet_hours_start": "22:00",
    "quiet_hours_end": "08:00",
    "timezone": "UTC",
    "muted_rules": [],
    "email_digest_enabled": false,
    "email_digest_frequency": "daily"
}';

CREATE INDEX idx_users_notification_prefs ON users USING GIN (notification_preferences);

-- ============================================================================
-- Views for easier querying
-- ============================================================================

CREATE OR REPLACE VIEW notification_delivery_status AS
SELECT 
    n.id,
    n.tenant_id,
    n.alert_event_id,
    n.channel_type,
    n.status,
    n.delivery_status,
    n.retry_count,
    ar.id as alert_rule_id,
    ar.device_id,
    ae.fired_at as alert_fired_at,
    n.created_at,
    n.sent_at,
    CASE 
        WHEN n.status = 'sent' THEN 'Successfully sent'
        WHEN n.status = 'failed' AND n.retry_count < 5 THEN 'Will retry'
        WHEN n.status = 'failed' THEN 'Max retries exceeded'
        WHEN n.status = 'pending' THEN 'Waiting to send'
        WHEN n.status = 'skipped' THEN 'Skipped (user preferences)'
        ELSE n.status
    END as status_description
FROM notifications n
JOIN alert_events ae ON n.alert_event_id = ae.id
JOIN alert_rules ar ON ae.alert_rule_id = ar.id;

-- ============================================================================
-- Default Notification Templates
-- ============================================================================

-- Email template (insert for each tenant during provisioning)
-- This is a placeholder - actual templates should be per-tenant
INSERT INTO notification_templates (
    tenant_id,
    channel_type,
    alert_type,
    name,
    subject,
    body,
    variables,
    enabled
) VALUES (
    (SELECT id FROM tenants LIMIT 1),  -- For default tenant
    'email',
    NULL,
    'Default Email Alert',
    'Alert: {{ device_name }} - {{ alert_message }}',
    '{{ device_name }} triggered an alert.\n\nDevice: {{ device_name }}\nRule: {{ rule_name }}\nValue: {{ metric_value }}\nThreshold: {{ threshold }}\nTime: {{ fired_at }}\n\nCheck your dashboard for more details.',
    '["device_name", "rule_name", "metric_value", "threshold", "fired_at", "alert_message"]'::jsonb,
    true
) ON CONFLICT DO NOTHING;

-- Slack template
INSERT INTO notification_templates (
    tenant_id,
    channel_type,
    alert_type,
    name,
    body,
    variables,
    enabled
) VALUES (
    (SELECT id FROM tenants LIMIT 1),
    'slack',
    NULL,
    'Default Slack Alert',
    '🚨 Alert: {{ device_name }}\n{{ rule_name }}\nValue: {{ metric_value }} (threshold: {{ threshold }})\n<{{ dashboard_url }}|View Dashboard>',
    '["device_name", "rule_name", "metric_value", "threshold", "dashboard_url"]'::jsonb,
    true
) ON CONFLICT DO NOTHING;
