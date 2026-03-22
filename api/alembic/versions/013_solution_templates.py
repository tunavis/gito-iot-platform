"""Re-create solution_templates table for industry vertical templates."""

from alembic import op

revision = "013_solution_templates"
down_revision = "012_command_schema"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS solution_templates (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(200) NOT NULL,
            slug VARCHAR(100) NOT NULL UNIQUE,
            description TEXT,
            industry VARCHAR(100) NOT NULL,
            icon VARCHAR(50),
            device_types JSONB NOT NULL DEFAULT '[]',
            dashboard_config JSONB NOT NULL DEFAULT '{}',
            alert_rules JSONB NOT NULL DEFAULT '[]',
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
    """)

    # Seed Water Monitoring template
    op.execute("""
        INSERT INTO solution_templates (name, slug, description, industry, icon, device_types, dashboard_config, alert_rules)
        VALUES (
            'Water Monitoring',
            'water-monitoring',
            'Complete water infrastructure monitoring — tank levels, flow rates, pressure, and quality. Includes leak detection and low-level alerts.',
            'Water & Utilities',
            'droplets',
            '[
                {"name": "Water Level Sensor", "description": "Ultrasonic water tank level sensor", "telemetry_schema": {"level_percent": {"type": "number", "unit": "%", "min": 0, "max": 100}, "level_cm": {"type": "number", "unit": "cm", "min": 0, "max": 500}, "volume_liters": {"type": "number", "unit": "L", "min": 0}}},
                {"name": "Flow Meter", "description": "Water flow rate and totalizer", "telemetry_schema": {"flow_rate_m3h": {"type": "number", "unit": "m³/hr", "min": 0}, "total_flow_m3": {"type": "number", "unit": "m³", "min": 0}}},
                {"name": "Pressure Sensor", "description": "Pipe pressure sensor", "telemetry_schema": {"pressure_kpa": {"type": "number", "unit": "kPa", "min": 0, "max": 1000}}},
                {"name": "Water Quality Sensor", "description": "pH and turbidity monitoring", "telemetry_schema": {"ph": {"type": "number", "unit": "pH", "min": 0, "max": 14}, "turbidity_ntu": {"type": "number", "unit": "NTU", "min": 0}}}
            ]'::jsonb,
            '{
                "name": "Water Monitoring Dashboard",
                "description": "Real-time water infrastructure monitoring",
                "widgets": [
                    {"widget_type": "kpi_card", "title": "Tank Level", "position_x": 0, "position_y": 0, "width": 3, "height": 2, "configuration": {"metric": "level_percent", "unit": "%", "warning_threshold": 20, "critical_threshold": 10, "trend_period": "24h"}, "data_sources": []},
                    {"widget_type": "kpi_card", "title": "Daily Consumption", "position_x": 3, "position_y": 0, "width": 3, "height": 2, "configuration": {"metric": "total_flow_m3", "unit": "m³", "trend_period": "24h"}, "data_sources": []},
                    {"widget_type": "kpi_card", "title": "Flow Rate", "position_x": 6, "position_y": 0, "width": 3, "height": 2, "configuration": {"metric": "flow_rate_m3h", "unit": "m³/hr", "trend_period": "1h"}, "data_sources": []},
                    {"widget_type": "kpi_card", "title": "Pressure", "position_x": 9, "position_y": 0, "width": 3, "height": 2, "configuration": {"metric": "pressure_kpa", "unit": "kPa", "trend_period": "1h"}, "data_sources": []},
                    {"widget_type": "chart", "title": "Tank Level Over Time", "position_x": 0, "position_y": 2, "width": 6, "height": 4, "configuration": {"chart_type": "area", "metrics": ["level_percent"], "time_range": "24h", "unit": "%"}, "data_sources": []},
                    {"widget_type": "chart", "title": "Flow Rate: Inlet vs Outlet", "position_x": 6, "position_y": 2, "width": 6, "height": 4, "configuration": {"chart_type": "line", "metrics": ["flow_rate_m3h"], "time_range": "24h", "unit": "m³/hr"}, "data_sources": []},
                    {"widget_type": "gauge", "title": "Tank Level", "position_x": 0, "position_y": 6, "width": 4, "height": 3, "configuration": {"metric": "level_percent", "unit": "%", "min": 0, "max": 100, "warning_threshold": 20, "critical_threshold": 10}, "data_sources": []},
                    {"widget_type": "status_matrix", "title": "Pump & Valve Status", "position_x": 4, "position_y": 6, "width": 4, "height": 3, "configuration": {}, "data_sources": []},
                    {"widget_type": "alarm_summary", "title": "Water System Alarms", "position_x": 0, "position_y": 9, "width": 12, "height": 3, "configuration": {"page_size": 50}, "data_sources": []}
                ]
            }'::jsonb,
            '[
                {"name": "Tank Level Low", "metric_key": "level_percent", "operator": "<", "threshold": 20, "severity": "WARNING", "message": "Tank level low"},
                {"name": "Tank Level Critical", "metric_key": "level_percent", "operator": "<", "threshold": 10, "severity": "CRITICAL", "message": "Tank level critical"},
                {"name": "Sensor Offline", "metric_key": "_no_data", "operator": "no_data", "threshold": 900, "severity": "WARNING", "message": "Sensor offline — no data for 15 minutes"}
            ]'::jsonb
        )
        ON CONFLICT (slug) DO NOTHING;
    """)


def downgrade():
    op.execute("DROP TABLE IF EXISTS solution_templates;")
