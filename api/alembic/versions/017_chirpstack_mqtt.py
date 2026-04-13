# api/alembic/versions/017_chirpstack_mqtt.py
"""Add chirpstack_mqtt provider — nullable key columns, partial unique index.

Revision ID: 017_chirpstack_mqtt
Revises: 016_extend_providers
Create Date: 2026-04-13
"""
from typing import Sequence, Union
from alembic import op

revision: str = "017_chirpstack_mqtt"
down_revision: Union[str, None] = "016_extend_providers"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Make key columns nullable — MQTT bridge integrations have no bearer key
    op.execute("""
        ALTER TABLE integrations ALTER COLUMN key_hash DROP NOT NULL;
    """)
    op.execute("""
        ALTER TABLE integrations ALTER COLUMN key_prefix DROP NOT NULL;
    """)

    # Replace simple unique index with partial index (only enforce when key_hash present)
    op.execute("""
        DROP INDEX IF EXISTS idx_integrations_key_hash;
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_key_hash
            ON integrations (key_hash) WHERE key_hash IS NOT NULL;
    """)

    # Extend valid_provider constraint to include chirpstack_mqtt
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
    op.execute("""
        ALTER TABLE integrations ADD CONSTRAINT valid_provider CHECK (
            provider IN (
                'chirpstack', 'ttn', 'helium', 'actility', 'custom',
                'mqtt', 'http', 'chirpstack_mqtt'
            )
        );
    """)


def downgrade() -> None:
    # Delete MQTT bridge integrations before restoring NOT NULL constraints
    # (they have key_hash = NULL which would violate the constraint)
    op.execute("""
        DELETE FROM integrations WHERE provider = 'chirpstack_mqtt';
    """)

    # Restore provider constraint without chirpstack_mqtt
    op.execute("ALTER TABLE integrations DROP CONSTRAINT IF EXISTS valid_provider;")
    op.execute("""
        ALTER TABLE integrations ADD CONSTRAINT valid_provider CHECK (
            provider IN ('chirpstack', 'ttn', 'helium', 'actility', 'custom', 'mqtt', 'http')
        );
    """)

    # Drop partial index and recreate as simple unique index
    op.execute("DROP INDEX IF EXISTS idx_integrations_key_hash;")
    op.execute("""
        CREATE UNIQUE INDEX idx_integrations_key_hash ON integrations (key_hash);
    """)

    # Restore NOT NULL — safe now that NULLs are gone
    op.execute("ALTER TABLE integrations ALTER COLUMN key_hash SET NOT NULL;")
    op.execute("ALTER TABLE integrations ALTER COLUMN key_prefix SET NOT NULL;")
