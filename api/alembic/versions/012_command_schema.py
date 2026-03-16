"""012: Add command_schema to device_types

Defines available RPC commands per device type with typed parameter schemas.

Revision ID: 012_command_schema
Revises: 011_device_commands
Create Date: 2026-03-16
"""

from typing import Union
from alembic import op

revision: str = "012_command_schema"
down_revision: Union[str, None] = "011_device_commands"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE device_types ADD COLUMN IF NOT EXISTS command_schema JSONB DEFAULT '{}'")


def downgrade() -> None:
    op.execute("ALTER TABLE device_types DROP COLUMN IF EXISTS command_schema")