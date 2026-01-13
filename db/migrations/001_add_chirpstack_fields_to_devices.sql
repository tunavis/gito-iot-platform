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
