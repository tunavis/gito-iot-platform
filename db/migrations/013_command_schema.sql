-- Migration 013: Add command_schema to device_types
-- Defines available RPC commands per device type with typed parameter schemas
BEGIN;
ALTER TABLE device_types ADD COLUMN IF NOT EXISTS command_schema JSONB DEFAULT '{}';
COMMIT;
