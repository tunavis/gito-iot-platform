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
