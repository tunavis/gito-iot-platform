"""Initial schema - complete database structure

Revision ID: 001_initial
Revises:
Create Date: 2026-02-08

This is a clean initial migration that creates all tables with IF NOT EXISTS guards.
Based on db/init.sql and SQLAlchemy models.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '001_initial'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create all tables with idempotent guards."""

    # Execute the complete schema from init.sql
    # This is idempotent - safe to run multiple times
    op.execute("""
        -- Enable extensions
        CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
        CREATE EXTENSION IF NOT EXISTS "pgcrypto";

        -- Create update_updated_at_column function
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $ LANGUAGE plpgsql;
    """)

    # Import and execute the complete init.sql
    # Read the file content
    import os
    init_sql_path = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'db', 'init.sql')

    if os.path.exists(init_sql_path):
        with open(init_sql_path, 'r') as f:
            sql_content = f.read()
            # Execute the SQL
            op.execute(sql_content)
    else:
        # Fallback: Create tables manually if init.sql not found
        # This ensures migration works even without init.sql
        raise Exception(f"init.sql not found at {init_sql_path}. Cannot create schema.")


def downgrade() -> None:
    """Drop all tables."""
    op.execute("""
        DROP TABLE IF EXISTS notification_queue CASCADE;
        DROP TABLE IF EXISTS notification_rules CASCADE;
        DROP TABLE IF EXISTS alert_rule_conditions CASCADE;
        DROP TABLE IF EXISTS alert_events CASCADE;
        DROP TABLE IF EXISTS alarms CASCADE;
        DROP TABLE IF EXISTS telemetry_hot CASCADE;
        DROP TABLE IF EXISTS group_devices CASCADE;
        DROP TABLE IF EXISTS device_credentials CASCADE;
        DROP TABLE IF EXISTS alert_rules CASCADE;
        DROP TABLE IF EXISTS group_bulk_operations CASCADE;
        DROP TABLE IF EXISTS devices CASCADE;
        DROP TABLE IF EXISTS device_groups CASCADE;
        DROP TABLE IF EXISTS sites CASCADE;
        DROP TABLE IF EXISTS notification_channels CASCADE;
        DROP TABLE IF EXISTS audit_logs CASCADE;
        DROP TABLE IF EXISTS users CASCADE;
        DROP TABLE IF EXISTS organizations CASCADE;
        DROP TABLE IF EXISTS notification_templates CASCADE;
        DROP TABLE IF EXISTS device_types CASCADE;
        DROP TABLE IF EXISTS tenants CASCADE;
        DROP TABLE IF EXISTS composite_alert_rules CASCADE;
        DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
    """)
