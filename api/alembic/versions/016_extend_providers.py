"""Extend valid_provider check constraint to include mqtt and http.

Revision ID: 016_extend_providers
Revises: 015_integrations
Create Date: 2026-04-11
"""
from typing import Sequence, Union
from alembic import op

revision: str = "016_extend_providers"
down_revision: Union[str, None] = "015_integrations"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop old constraint (idempotent)
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE table_name = 'integrations' AND constraint_name = 'valid_provider'
            ) THEN
                ALTER TABLE integrations DROP CONSTRAINT valid_provider;
            END IF;
        END $$;
    """)
    # Add expanded constraint
    op.execute("""
        ALTER TABLE integrations ADD CONSTRAINT valid_provider CHECK (
            provider IN ('chirpstack', 'ttn', 'helium', 'actility', 'custom', 'mqtt', 'http')
        );
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE integrations DROP CONSTRAINT IF EXISTS valid_provider;")
    op.execute("""
        ALTER TABLE integrations ADD CONSTRAINT valid_provider CHECK (
            provider IN ('chirpstack', 'ttn', 'helium', 'actility', 'custom')
        );
    """)
