-- Migration 011: Add firmware and hardware version tracking to devices
-- Required for OTA firmware management and device inventory

ALTER TABLE devices ADD COLUMN IF NOT EXISTS firmware_version VARCHAR(50);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS hardware_version VARCHAR(50);

-- Index for firmware version queries (useful for OTA targeting)
CREATE INDEX IF NOT EXISTS idx_devices_firmware_version ON devices (firmware_version) WHERE firmware_version IS NOT NULL;
