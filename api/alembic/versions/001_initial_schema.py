"""Initial schema - complete database structure

Revision ID: 001_initial
Revises:
Create Date: 2026-02-08

This migration runs the idempotent init.sql file which creates all tables.
The init.sql is 100% idempotent - safe to run on fresh or existing databases.
"""
from typing import Sequence, Union
from alembic import op
import os

# revision identifiers, used by Alembic.
revision: str = '001_initial'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Run the idempotent init.sql to create/update all tables."""

    # Path to init.sql in Docker container
    init_sql_path = '/app/db/init.sql'

    # Fallback for local development
    if not os.path.exists(init_sql_path):
        # Try relative path from project root
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
        init_sql_path = os.path.join(project_root, 'db', 'init.sql')

    if not os.path.exists(init_sql_path):
        raise FileNotFoundError(f"Cannot find init.sql at {init_sql_path}")

    with open(init_sql_path, 'r') as f:
        sql_content = f.read()

    # Execute the idempotent SQL
    op.execute(sql_content)


def downgrade() -> None:
    """Drop all tables in reverse dependency order."""
    op.execute("""
        -- Drop in reverse dependency order
        DROP TABLE IF EXISTS notification_queue CASCADE;
        DROP TABLE IF EXISTS notifications CASCADE;
        DROP TABLE IF EXISTS notification_rules CASCADE;
        DROP TABLE IF EXISTS notification_channels CASCADE;
        DROP TABLE IF EXISTS notification_templates CASCADE;
        DROP TABLE IF EXISTS notification_settings CASCADE;
        DROP TABLE IF EXISTS dashboard_widgets CASCADE;
        DROP TABLE IF EXISTS dashboards CASCADE;
        DROP TABLE IF EXISTS solution_templates CASCADE;
        DROP TABLE IF EXISTS device_availability_log CASCADE;
        DROP TABLE IF EXISTS device_events CASCADE;
        DROP TABLE IF EXISTS event_types CASCADE;
        DROP TABLE IF EXISTS device_profiles CASCADE;
        DROP TABLE IF EXISTS ota_campaign_devices CASCADE;
        DROP TABLE IF EXISTS ota_campaigns CASCADE;
        DROP TABLE IF EXISTS device_firmware_history CASCADE;
        DROP TABLE IF EXISTS firmware_versions CASCADE;
        DROP TABLE IF EXISTS group_bulk_operations CASCADE;
        DROP TABLE IF EXISTS group_devices CASCADE;
        DROP TABLE IF EXISTS alarms CASCADE;
        DROP TABLE IF EXISTS alert_events CASCADE;
        DROP TABLE IF EXISTS alert_rule_conditions CASCADE;
        DROP TABLE IF EXISTS composite_alert_rules CASCADE;
        DROP TABLE IF EXISTS alert_rules CASCADE;
        DROP TABLE IF EXISTS telemetry_hot CASCADE;
        DROP TABLE IF EXISTS device_credentials CASCADE;
        DROP TABLE IF EXISTS devices CASCADE;
        DROP TABLE IF EXISTS device_groups CASCADE;
        DROP TABLE IF EXISTS device_types CASCADE;
        DROP TABLE IF EXISTS sites CASCADE;
        DROP TABLE IF EXISTS organizations CASCADE;
        DROP TABLE IF EXISTS audit_logs CASCADE;
        DROP TABLE IF EXISTS users CASCADE;
        DROP TABLE IF EXISTS tenants CASCADE;
        DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
    """)
