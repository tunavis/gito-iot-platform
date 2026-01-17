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
