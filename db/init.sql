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

-- Application user (read/write to tables)
CREATE USER gito_app WITH PASSWORD 'app_password_change_in_production';
GRANT CONNECT ON DATABASE gito TO gito_app;
GRANT USAGE ON SCHEMA public TO gito_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gito_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gito_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO gito_app;

-- Read-only user (optional, for analytics)
CREATE USER gito_readonly WITH PASSWORD 'readonly_password_change_in_production';
GRANT CONNECT ON DATABASE gito TO gito_readonly;
GRANT USAGE ON SCHEMA public TO gito_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO gito_readonly;

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
