"""Add resolve_device_token SECURITY DEFINER function for token-based device ingest.

This function bypasses RLS so the ingest endpoint can look up a device_credential
by its token hash without needing to know the tenant_id first.
The function is owned by gito_user (the table owner), which means it bypasses
RLS for device_credentials (table owners are exempt from ENABLE ROW LEVEL SECURITY
without FORCE).

Revision ID: 006_device_token_lookup
Revises: 005_nullable_device_hierarchy
Create Date: 2026-02-21
"""
from typing import Sequence, Union
from alembic import op

revision: str = "006_device_token_lookup"
down_revision: Union[str, None] = "005_nullable_device_hierarchy"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE OR REPLACE FUNCTION resolve_device_token(p_token_hash TEXT)
        RETURNS TABLE(tenant_id UUID, device_id UUID)
        SECURITY DEFINER
        SET search_path = public
        LANGUAGE SQL
        AS $$
            SELECT dc.tenant_id, dc.device_id
            FROM device_credentials dc
            WHERE dc.credential_hash = p_token_hash
              AND dc.credential_type = 'device_token'
              AND dc.status = 'active'
              AND (dc.expires_at IS NULL OR dc.expires_at > now())
            LIMIT 1;
        $$;
    """)


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS resolve_device_token(TEXT);")
