-- ============================================================================
-- Migration 005: Composite Alert Rules
-- Multi-condition alert rules with AND/OR logic
-- ============================================================================

CREATE TABLE IF NOT EXISTS composite_alert_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    enabled BOOLEAN DEFAULT true,
    conditions JSONB NOT NULL DEFAULT '[]', -- Array of condition objects
    logic VARCHAR(10) NOT NULL DEFAULT 'AND', -- 'AND' or 'OR'
    severity VARCHAR(20) NOT NULL DEFAULT 'warning', -- 'info', 'warning', 'critical'
    weight_score INTEGER, -- Optional priority weight (0-100)
    cooldown_minutes INTEGER DEFAULT 5,
    last_triggered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT valid_logic CHECK (logic IN ('AND', 'OR')),
    CONSTRAINT valid_severity CHECK (severity IN ('info', 'warning', 'critical'))
);

-- Indexes
CREATE INDEX idx_composite_alert_rules_tenant ON composite_alert_rules(tenant_id);
CREATE INDEX idx_composite_alert_rules_enabled ON composite_alert_rules(enabled);
CREATE INDEX idx_composite_alert_rules_severity ON composite_alert_rules(severity);
CREATE INDEX idx_composite_alert_rules_conditions ON composite_alert_rules USING GIN(conditions);

-- RLS Policies
ALTER TABLE composite_alert_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS composite_alert_rules_tenant_isolation ON composite_alert_rules;
CREATE POLICY composite_alert_rules_tenant_isolation ON composite_alert_rules
    USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_composite_alert_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_composite_alert_rules_updated_at ON composite_alert_rules;
CREATE TRIGGER trigger_composite_alert_rules_updated_at
    BEFORE UPDATE ON composite_alert_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_composite_alert_rules_updated_at();

COMMENT ON TABLE composite_alert_rules IS 'Multi-condition alert rules with AND/OR logic for complex scenarios';
COMMENT ON COLUMN composite_alert_rules.conditions IS 'JSON array of conditions: [{"field": "temperature", "operator": "gt", "value": 30}]';
COMMENT ON COLUMN composite_alert_rules.logic IS 'How to combine conditions: AND (all must match) or OR (any must match)';
COMMENT ON COLUMN composite_alert_rules.weight_score IS 'Priority weight for scoring and notification routing';
