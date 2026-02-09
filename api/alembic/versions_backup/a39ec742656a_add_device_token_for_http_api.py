"""add_device_token_for_http_api

Revision ID: a39ec742656a
Revises: ce718640f104
Create Date: 2026-02-08 14:06:03.154101

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a39ec742656a'
down_revision: Union[str, None] = 'ce718640f104'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add device_token column for HTTP API authentication
    # Idempotent: only add if column doesn't exist
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'devices' AND column_name = 'device_token'
            ) THEN
                ALTER TABLE devices ADD COLUMN device_token VARCHAR(255);
            END IF;
        END $$;
    """)

    # Add index for faster token lookups (idempotent)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_indexes WHERE indexname = 'idx_devices_token'
            ) THEN
                CREATE INDEX idx_devices_token ON devices(device_token);
            END IF;
        END $$;
    """)


def downgrade() -> None:
    # Drop index if exists (idempotent)
    op.execute("""
        DROP INDEX IF EXISTS idx_devices_token;
    """)

    # Drop column if exists (idempotent)
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'devices' AND column_name = 'device_token'
            ) THEN
                ALTER TABLE devices DROP COLUMN device_token;
            END IF;
        END $$;
    """)
