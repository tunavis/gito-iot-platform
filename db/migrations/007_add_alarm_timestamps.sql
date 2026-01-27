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
