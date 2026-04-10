"""Add integrations table for universal LoRaWAN webhook ingestion.

Stores one row per tenant integration (TTN, ChirpStack, Helium, Actility, custom).
Authentication uses a hashed bearer key — raw key is never stored.
The resolve_integration_key SECURITY DEFINER function bypasses RLS for key lookup,
matching the same pattern as resolve_device_token.

Revision ID: 015_integrations
Revises: 014_key_mapping
Create Date: 2026-04-10
"""
from typing import Sequence, Union
from alembic import op

revision: str = "015_integrations"
down_revision: Union[str, None] = "014_key_mapping"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS integrations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            name VARCHAR(100) NOT NULL,
            provider VARCHAR(50) NOT NULL,
            key_hash VARCHAR(64) NOT NULL,
            key_prefix VARCHAR(12) NOT NULL,
            config JSONB NOT NULL DEFAULT '{}',
            is_active BOOLEAN NOT NULL DEFAULT true,
            last_used_at TIMESTAMPTZ,
            message_count BIGINT NOT NULL DEFAULT 0,
            created_by UUID REFERENCES users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT integrations_tenant_name_unique UNIQUE (tenant_id, name),
            CONSTRAINT valid_provider CHECK (
                provider IN ('chirpstack', 'ttn', 'helium', 'actility', 'custom')
            )
        );
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_integrations_tenant
            ON integrations (tenant_id);
    """)

    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_key_hash
            ON integrations (key_hash);
    """)

    op.execute("""
        ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
    """)

    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE tablename = 'integrations' AND policyname = 'tenant_isolation'
            ) THEN
                CREATE POLICY tenant_isolation ON integrations
                    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
            END IF;
        END $$;
    """)

    op.execute("""
        CREATE OR REPLACE FUNCTION resolve_integration_key(p_key_hash TEXT)
        RETURNS TABLE(
            integration_id UUID,
            tenant_id UUID,
            provider VARCHAR,
            config JSONB,
            is_active BOOLEAN
        )
        SECURITY DEFINER
        SET search_path = public
        LANGUAGE SQL
        AS $$
            SELECT id, tenant_id, provider, config, is_active
            FROM integrations
            WHERE key_hash = p_key_hash
            LIMIT 1;
        $$;
    """)


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS resolve_integration_key(TEXT);")
    op.execute("DROP TABLE IF EXISTS integrations;")
