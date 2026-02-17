"""Drop valid_metric CHECK constraint on alert_rules to support dynamic metrics

With the key-value telemetry refactor, devices can have any metric defined
in their device type's telemetry_schema. The old CHECK constraint limited
metrics to only 5 hardcoded values (temperature, humidity, battery, rssi, pressure).

Revision ID: 003_drop_valid_metric
Revises: 002_device_fields
Create Date: 2026-02-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '003_drop_valid_metric'
down_revision: Union[str, None] = '002_device_fields'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Drop the valid_metric CHECK constraint to allow any metric key."""
    op.execute("""
        ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS valid_metric;
    """)


def downgrade() -> None:
    """Re-add the valid_metric CHECK constraint."""
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'valid_metric'
            ) THEN
                ALTER TABLE alert_rules
                ADD CONSTRAINT valid_metric
                CHECK (metric IN ('temperature', 'humidity', 'battery', 'rssi', 'pressure'));
            END IF;
        END $$;
    """)
