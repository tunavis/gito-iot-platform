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
