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
