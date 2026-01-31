-- Migration 010: Dashboard System
-- Creates tables for dashboard builder and solution templates

-- ================================================================
-- 1. DASHBOARDS TABLE
-- ================================================================
CREATE TABLE IF NOT EXISTS dashboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    is_default BOOLEAN DEFAULT false,
    layout_config JSONB DEFAULT '{}',
    theme JSONB DEFAULT '{}',
    solution_type VARCHAR(100),
    extra_data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT dashboards_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT dashboards_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for dashboards
CREATE INDEX IF NOT EXISTS idx_dashboards_tenant_user ON dashboards(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_dashboards_solution_type ON dashboards(solution_type);
CREATE INDEX IF NOT EXISTS idx_dashboards_created_at ON dashboards(created_at DESC);

-- ================================================================
-- 2. DASHBOARD WIDGETS TABLE
-- ================================================================
CREATE TABLE IF NOT EXISTS dashboard_widgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dashboard_id UUID NOT NULL,
    widget_type VARCHAR(50) NOT NULL,
    title VARCHAR(200),
    position_x INTEGER NOT NULL,
    position_y INTEGER NOT NULL,
    width INTEGER NOT NULL DEFAULT 2,
    height INTEGER NOT NULL DEFAULT 2,
    configuration JSONB NOT NULL DEFAULT '{}',
    data_sources JSONB DEFAULT '[]',
    refresh_interval INTEGER DEFAULT 30,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT dashboard_widgets_dashboard_id_fkey FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE,
    CONSTRAINT check_positive_dimensions CHECK (width > 0 AND height > 0),
    CONSTRAINT check_valid_position CHECK (position_x >= 0 AND position_y >= 0)
);

-- Indexes for dashboard_widgets
CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_dashboard ON dashboard_widgets(dashboard_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_type ON dashboard_widgets(widget_type);

-- ================================================================
-- 3. SOLUTION TEMPLATES TABLE
-- ================================================================
CREATE TABLE IF NOT EXISTS solution_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL UNIQUE,
    identifier VARCHAR(100) NOT NULL UNIQUE,
    category VARCHAR(50) NOT NULL,
    description TEXT,
    icon VARCHAR(50) DEFAULT 'layout-dashboard',
    color VARCHAR(20) DEFAULT '#0066CC',
    target_device_types JSONB DEFAULT '[]',
    required_capabilities JSONB DEFAULT '[]',
    template_config JSONB NOT NULL,
    preview_image_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for solution_templates
CREATE INDEX IF NOT EXISTS idx_solution_templates_category ON solution_templates(category);
CREATE INDEX IF NOT EXISTS idx_solution_templates_active ON solution_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_solution_templates_identifier ON solution_templates(identifier);

-- ================================================================
-- 4. ENABLE ROW LEVEL SECURITY
-- ================================================================
ALTER TABLE dashboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_widgets ENABLE ROW LEVEL SECURITY;

-- RLS Policies for dashboards
-- Users can only see their own dashboards within their tenant
DROP POLICY IF EXISTS tenant_isolation_dashboards ON dashboards;
CREATE POLICY tenant_isolation_dashboards ON dashboards
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

DROP POLICY IF EXISTS user_dashboards_access ON dashboards;
CREATE POLICY user_dashboards_access ON dashboards
    FOR ALL
    USING (
        user_id = current_setting('app.current_user_id')::UUID
        AND tenant_id = current_setting('app.current_tenant_id')::UUID
    );

-- RLS Policies for dashboard_widgets
-- Users can only access widgets from their own dashboards
DROP POLICY IF EXISTS user_dashboard_widgets_access ON dashboard_widgets;
CREATE POLICY user_dashboard_widgets_access ON dashboard_widgets
    FOR ALL
    USING (
        dashboard_id IN (
            SELECT id FROM dashboards
            WHERE user_id = current_setting('app.current_user_id')::UUID
            AND tenant_id = current_setting('app.current_tenant_id')::UUID
        )
    );

-- ================================================================
-- 5. UPDATED_AT TRIGGERS
-- ================================================================
-- Create trigger function if not exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers
DROP TRIGGER IF EXISTS update_dashboards_updated_at ON dashboards;
CREATE TRIGGER update_dashboards_updated_at
    BEFORE UPDATE ON dashboards
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_dashboard_widgets_updated_at ON dashboard_widgets;
CREATE TRIGGER update_dashboard_widgets_updated_at
    BEFORE UPDATE ON dashboard_widgets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_solution_templates_updated_at ON solution_templates;
CREATE TRIGGER update_solution_templates_updated_at
    BEFORE UPDATE ON solution_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ================================================================
-- 6. SEED DATA: Water Meter Monitoring Template
-- ================================================================
INSERT INTO solution_templates (
    name,
    identifier,
    category,
    description,
    icon,
    color,
    target_device_types,
    required_capabilities,
    template_config,
    is_active
) VALUES (
    'Water Flow Monitoring',
    'water_flow_monitoring',
    'utilities',
    'Comprehensive water flow monitoring dashboard with real-time metrics, flow rate tracking, velocity analysis, and cumulative volume measurements. Ideal for water utilities, irrigation systems, and industrial water management.',
    'droplet',
    '#0ea5e9',
    '["water_meter", "flow_sensor", "water_flow_sensor"]'::jsonb,
    '["flow_rate", "velocity", "total_volume", "positive_cumulative", "negative_cumulative"]'::jsonb,
    '{
        "theme": {
            "primary_color": "#0ea5e9",
            "title": "Water Flow Monitoring"
        },
        "widgets": [
            {
                "type": "device_info",
                "title": "Device Information",
                "position": {"x": 0, "y": 0, "w": 3, "h": 3},
                "config": {
                    "show_image": true,
                    "show_status": true,
                    "show_location": true,
                    "show_metadata": true
                },
                "data_binding": {
                    "auto_bind": true
                }
            },
            {
                "type": "kpi_card",
                "title": "Velocity",
                "position": {"x": 3, "y": 0, "w": 3, "h": 2},
                "config": {
                    "metric": "velocity",
                    "unit": "m/s",
                    "decimal_places": 2,
                    "show_trend": true,
                    "trend_period": "24h",
                    "icon": "gauge",
                    "color": "#3b82f6"
                },
                "data_binding": {
                    "metric": "velocity",
                    "auto_bind": true
                }
            },
            {
                "type": "kpi_card",
                "title": "Flow Rate",
                "position": {"x": 6, "y": 0, "w": 3, "h": 2},
                "config": {
                    "metric": "flow_rate",
                    "unit": "m³/hr",
                    "decimal_places": 2,
                    "show_trend": true,
                    "trend_period": "24h",
                    "icon": "droplet",
                    "color": "#10b981"
                },
                "data_binding": {
                    "metric": "flow_rate",
                    "auto_bind": true
                }
            },
            {
                "type": "kpi_card",
                "title": "Today Total",
                "position": {"x": 9, "y": 0, "w": 3, "h": 2},
                "config": {
                    "metric": "positive_cumulative",
                    "unit": "m³",
                    "decimal_places": 2,
                    "show_trend": false,
                    "icon": "activity",
                    "color": "#8b5cf6"
                },
                "data_binding": {
                    "metric": "positive_cumulative",
                    "auto_bind": true,
                    "aggregation": "latest"
                }
            },
            {
                "type": "chart",
                "title": "Velocity - Last 12 Hours",
                "position": {"x": 0, "y": 3, "w": 6, "h": 4},
                "config": {
                    "chart_type": "area",
                    "metrics": ["velocity"],
                    "time_range": "12h",
                    "aggregation": "avg",
                    "y_axis_label": "Velocity (m/s)",
                    "show_legend": true,
                    "colors": ["#3b82f6"],
                    "fill_opacity": 0.3
                },
                "data_binding": {
                    "metrics": ["velocity"],
                    "auto_bind": true
                }
            },
            {
                "type": "chart",
                "title": "Flow Rate - Last 12 Hours",
                "position": {"x": 6, "y": 3, "w": 6, "h": 4},
                "config": {
                    "chart_type": "area",
                    "metrics": ["flow_rate"],
                    "time_range": "12h",
                    "aggregation": "avg",
                    "y_axis_label": "Flow Rate (m³/hr)",
                    "show_legend": true,
                    "colors": ["#10b981"],
                    "fill_opacity": 0.3
                },
                "data_binding": {
                    "metrics": ["flow_rate"],
                    "auto_bind": true
                }
            },
            {
                "type": "table",
                "title": "Real-time Data - Last 24 Hours",
                "position": {"x": 0, "y": 7, "w": 10, "h": 4},
                "config": {
                    "columns": [
                        {"field": "timestamp", "label": "Timestamp", "format": "datetime"},
                        {"field": "flow_rate", "label": "Flow Rate (m³/hr)", "format": "decimal:2"},
                        {"field": "velocity", "label": "Velocity (m/s)", "format": "decimal:2"},
                        {"field": "positive_cumulative", "label": "Positive Total (m³)", "format": "decimal:2"},
                        {"field": "negative_cumulative", "label": "Negative Total (m³)", "format": "decimal:2"}
                    ],
                    "page_size": 10,
                    "auto_refresh": true,
                    "sort_by": "timestamp",
                    "sort_order": "desc"
                },
                "data_binding": {
                    "auto_bind": true,
                    "time_range": "24h"
                }
            },
            {
                "type": "map",
                "title": "Device Location",
                "position": {"x": 10, "y": 7, "w": 2, "h": 4},
                "config": {
                    "zoom": 15,
                    "show_label": true,
                    "show_marker": true,
                    "marker_color": "#0ea5e9"
                },
                "data_binding": {
                    "auto_bind": true
                }
            }
        ]
    }'::jsonb,
    true
) ON CONFLICT (identifier) DO UPDATE SET
    name = EXCLUDED.name,
    category = EXCLUDED.category,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    color = EXCLUDED.color,
    target_device_types = EXCLUDED.target_device_types,
    required_capabilities = EXCLUDED.required_capabilities,
    template_config = EXCLUDED.template_config,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

-- ================================================================
-- 7. COMMENTS
-- ================================================================
COMMENT ON TABLE dashboards IS 'User-created dashboards with customizable layouts and widgets';
COMMENT ON TABLE dashboard_widgets IS 'Individual widgets placed on dashboards with configuration and data bindings';
COMMENT ON TABLE solution_templates IS 'Pre-built industry-specific dashboard templates';

COMMENT ON COLUMN dashboards.is_default IS 'Whether this dashboard is shown by default on login';
COMMENT ON COLUMN dashboards.layout_config IS 'Grid layout configuration including breakpoints and column settings';
COMMENT ON COLUMN dashboards.theme IS 'Dashboard-specific color scheme and branding';
COMMENT ON COLUMN dashboards.solution_type IS 'Identifier of the solution template used to create this dashboard';

COMMENT ON COLUMN dashboard_widgets.widget_type IS 'Widget type: kpi_card, chart, gauge, map, table, device_info, etc.';
COMMENT ON COLUMN dashboard_widgets.configuration IS 'Widget-specific configuration (chart type, colors, thresholds, etc.)';
COMMENT ON COLUMN dashboard_widgets.data_sources IS 'Array of device IDs and metrics bound to this widget';
COMMENT ON COLUMN dashboard_widgets.refresh_interval IS 'Auto-refresh interval in seconds';

COMMENT ON COLUMN solution_templates.identifier IS 'Unique slug identifier for the template';
COMMENT ON COLUMN solution_templates.target_device_types IS 'Array of compatible device type identifiers';
COMMENT ON COLUMN solution_templates.required_capabilities IS 'Array of required telemetry capabilities/metrics';
COMMENT ON COLUMN solution_templates.template_config IS 'Complete dashboard and widget configuration blueprint';
