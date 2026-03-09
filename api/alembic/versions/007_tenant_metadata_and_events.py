"""Add tenant metadata column and events table.

- tenants.metadata JSONB — stores tenant profile extras (contact, timezone,
  integration config, retention policy)
- events table — IoT event stream (device lifecycle, alarm changes, custom events)

Revision ID: 007_tenant_metadata_and_events
Revises: 006_device_token_lookup
Create Date: 2026-03-08
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "007_tenant_metadata_and_events"
down_revision: Union[str, None] = "006_device_token_lookup"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. Add metadata column to tenants ────────────────────────────────────
    op.execute("""
        ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
    """)

    # ── 2. Create events table ───────────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS events (
            id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            device_id   UUID        REFERENCES devices(id) ON DELETE SET NULL,
            event_type  VARCHAR(100) NOT NULL,
            severity    VARCHAR(20)  NOT NULL DEFAULT 'INFO',
            message     TEXT,
            payload     JSONB        NOT NULL DEFAULT '{}',
            ts          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        );
    """)

    # Indexes for common query patterns
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_events_tenant_ts
            ON events (tenant_id, ts DESC);
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_events_device
            ON events (device_id, ts DESC)
            WHERE device_id IS NOT NULL;
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_events_type
            ON events (tenant_id, event_type, ts DESC);
    """)

    # ── 3. RLS for events ────────────────────────────────────────────────────
    op.execute("ALTER TABLE events ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE tablename = 'events' AND policyname = 'tenant_isolation'
            ) THEN
                CREATE POLICY tenant_isolation ON events
                    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS events;")
    op.execute("""
        ALTER TABLE tenants DROP COLUMN IF EXISTS metadata;
    """)
