"""Initial schema from init.sql

Revision ID: 001_initial
Revises: 
Create Date: 2026-02-12 00:00:00.000000

"""
from typing import Sequence, Union
from pathlib import Path

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '001_initial'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Run the init.sql file to create all tables, indexes, RLS, triggers, and seed data."""
    # Find init.sql relative to this migration file
    init_sql_path = Path(__file__).resolve().parent.parent.parent / "db" / "init.sql"
    
    if not init_sql_path.exists():
        # Fallback: try relative to working directory
        init_sql_path = Path("db/init.sql")
    
    if not init_sql_path.exists():
        raise FileNotFoundError(
            f"Could not find init.sql. Searched:\n"
            f"  - {Path(__file__).resolve().parent.parent.parent / 'db' / 'init.sql'}\n"
            f"  - {Path('db/init.sql').resolve()}"
        )
    
    sql = init_sql_path.read_text(encoding="utf-8")
    
    # Execute the full SQL file
    op.execute(sql)


def downgrade() -> None:
    """Drop all tables in reverse dependency order."""
    tables = [
        "notification_queue",
        "notifications",
        "notification_rules",
        "notification_channels",
        "notification_templates",
        "ota_campaign_devices",
        "ota_campaigns",
        "device_firmware_history",
        "firmware_versions",
        "group_bulk_operations",
        "group_devices",
        "dashboard_widgets",
        "dashboards",

        "composite_alert_rules",
        "alarms",
        "alert_events",
        "alert_rule_conditions",
        "alert_rules",
        "audit_logs",
        "device_credentials",
        "telemetry",
        "devices",
        "device_groups",
        "device_types",
        "sites",
        "organizations",
        "users",
        "tenants",
    ]
    for table in tables:
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
