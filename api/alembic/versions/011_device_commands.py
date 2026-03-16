"""011: Device Commands (RPC) + Gateway support

Adds device_commands table for request-response command lifecycle tracking.
Adds gateway_id FK on devices for gateway sub-device fan-out.

Revision ID: 011_device_commands
Revises: 010_timescaledb
Create Date: 2026-03-16
"""

from typing import Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision: str = "011_device_commands"
down_revision: Union[str, None] = "010_timescaledb"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Device commands table
    op.execute("""
        CREATE TABLE IF NOT EXISTS device_commands (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
            command_name VARCHAR(100) NOT NULL,
            parameters JSONB DEFAULT '{}',
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            response JSONB,
            error_message TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '60 seconds'),
            sent_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ,
            CONSTRAINT valid_command_status CHECK (
                status IN ('pending', 'sent', 'delivered', 'executed', 'failed', 'timed_out')
            )
        )
    """)

    op.execute("CREATE INDEX IF NOT EXISTS idx_device_commands_tenant ON device_commands(tenant_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_device_commands_device ON device_commands(device_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_device_commands_status ON device_commands(status)")
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_device_commands_expires ON device_commands(expires_at)
            WHERE status IN ('pending', 'sent', 'delivered')
    """)

    # RLS
    op.execute("ALTER TABLE device_commands ENABLE ROW LEVEL SECURITY")
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE tablename = 'device_commands'
                AND policyname = 'tenant_isolation_device_commands'
            ) THEN
                CREATE POLICY tenant_isolation_device_commands ON device_commands
                    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
            END IF;
        END $$
    """)

    # 2. Gateway support
    op.execute("ALTER TABLE devices ADD COLUMN IF NOT EXISTS gateway_id UUID REFERENCES devices(id) ON DELETE SET NULL")
    op.execute("CREATE INDEX IF NOT EXISTS idx_devices_gateway ON devices(gateway_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS device_commands")
    op.execute("ALTER TABLE devices DROP COLUMN IF EXISTS gateway_id")