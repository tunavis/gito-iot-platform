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
