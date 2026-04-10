"""Add key_mapping column to device_types for telemetry key normalization.

Devices from different manufacturers send telemetry with arbitrary key names
(e.g., WATER_FLOW_BOILER instead of flow_rate). The key_mapping column stores
a mapping from raw device keys to canonical keys defined in the data_model.

Example: {"WATER_FLOW_BOILER": "flow_rate", "RAW_TEMP_1": "temperature"}

Revision ID: 014_key_mapping
Revises: 013_solution_templates
Create Date: 2026-03-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '014_key_mapping'
down_revision = '013_solution_templates'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE device_types
        ADD COLUMN IF NOT EXISTS key_mapping JSONB DEFAULT '{}'::jsonb;
    """)
    op.execute("""
        COMMENT ON COLUMN device_types.key_mapping IS
            'Maps raw device telemetry keys to canonical data_model keys. E.g. {"WATER_FLOW_BOILER": "flow_rate"}';
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE device_types DROP COLUMN IF EXISTS key_mapping;")
