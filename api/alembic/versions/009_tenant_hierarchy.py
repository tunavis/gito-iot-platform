"""Add tenant hierarchy: parent_tenant_id, tenant_type, is_ancestor_tenant().

Enables Gito (management tenant) to view and manage all client tenants
while keeping existing RLS policies completely unchanged.

Revision ID: 009_tenant_hierarchy
Revises: 008_ota_firmware_tables
Create Date: 2026-03-08
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "009_tenant_hierarchy"
down_revision: Union[str, None] = "008_ota_firmware_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. Add parent_tenant_id (self-referencing FK, nullable) ────────────
    op.execute("""
        ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS parent_tenant_id UUID
        REFERENCES tenants(id) ON DELETE RESTRICT
    """)

    # ── 2. Ensure tenant_type column exists (may already exist as 'standard' default)
    op.execute("""
        ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS tenant_type VARCHAR(50)
        NOT NULL DEFAULT 'client'
    """)

    # ── 3. Index on parent_tenant_id ────────────────────────────────────────
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_tenants_parent_id
        ON tenants(parent_tenant_id)
    """)

    # ── 4. Recursive SQL helper function ────────────────────────────────────
    # Returns TRUE if ancestor_id is equal to or an ancestor of descendant_id.
    # Used by validate_tenant_access() in Python to avoid rewriting RLS policies.
    op.execute("""
        CREATE OR REPLACE FUNCTION is_ancestor_tenant(
            ancestor_id UUID,
            descendant_id UUID
        ) RETURNS BOOLEAN AS $func$
        DECLARE
            result BOOLEAN;
        BEGIN
            WITH RECURSIVE chain AS (
                SELECT id, parent_tenant_id
                FROM tenants
                WHERE id = descendant_id
              UNION ALL
                SELECT t.id, t.parent_tenant_id
                FROM tenants t
                JOIN chain c ON t.id = c.parent_tenant_id
            )
            SELECT EXISTS (SELECT 1 FROM chain WHERE id = ancestor_id)
            INTO result;
            RETURN result;
        END;
        $func$ LANGUAGE plpgsql STABLE
    """)

    # ── 5. Seed: mark the first/only tenant as management type ─────────────
    # Idempotent: marks the oldest tenant as management regardless of its
    # current tenant_type value (handles 'standard', 'client', or any default).
    op.execute("""
        UPDATE tenants
        SET tenant_type = 'management'
        WHERE id = (SELECT id FROM tenants ORDER BY created_at LIMIT 1)
          AND tenant_type != 'management'
    """)


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS is_ancestor_tenant(UUID, UUID)")
    op.execute("DROP INDEX IF EXISTS ix_tenants_parent_id")
    op.execute("""
        ALTER TABLE tenants
        DROP CONSTRAINT IF EXISTS valid_tenant_type,
        DROP COLUMN IF EXISTS tenant_type,
        DROP COLUMN IF EXISTS parent_tenant_id
    """)
