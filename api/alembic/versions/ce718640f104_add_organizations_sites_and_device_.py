"""add_organizations_sites_and_device_hierarchy

Revision ID: ce718640f104
Revises: d0ee0e8c590a
Create Date: 2026-02-06 20:05:24.672633

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ce718640f104'
down_revision: Union[str, None] = 'd0ee0e8c590a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Idempotent migration to add organizations, sites, and device hierarchy.
    Safe to run on both fresh databases and staging (already patched).
    """

    # ============================================================================
    # 1. CREATE ORGANIZATIONS TABLE (IF NOT EXISTS)
    # ============================================================================
    op.execute("""
        CREATE TABLE IF NOT EXISTS organizations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            slug VARCHAR(100) NOT NULL,
            description TEXT,
            billing_contact VARCHAR(255),
            chirpstack_app_id VARCHAR(100),
            status VARCHAR(50) NOT NULL DEFAULT 'active',
            attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT valid_org_status CHECK (status IN ('active', 'inactive', 'suspended'))
        );
    """)

    # Organizations indexes (IF NOT EXISTS)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_organizations_tenant ON organizations(tenant_id);
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(tenant_id, slug);
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_organizations_chirpstack ON organizations(chirpstack_app_id)
        WHERE chirpstack_app_id IS NOT NULL;
    """)

    # ============================================================================
    # 2. CREATE SITES TABLE (IF NOT EXISTS)
    # ============================================================================
    op.execute("""
        CREATE TABLE IF NOT EXISTS sites (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            parent_site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            site_type VARCHAR(50),
            address TEXT,
            coordinates JSONB,
            timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
            attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """)

    # Sites indexes (IF NOT EXISTS)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_sites_tenant ON sites(tenant_id);
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_sites_organization ON sites(organization_id);
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_sites_parent ON sites(parent_site_id);
    """)

    # ============================================================================
    # 3. ADD HIERARCHY COLUMNS TO DEVICES TABLE (IF NOT EXISTS)
    # ============================================================================
    op.execute("""
        ALTER TABLE devices ADD COLUMN IF NOT EXISTS organization_id UUID;
    """)
    op.execute("""
        ALTER TABLE devices ADD COLUMN IF NOT EXISTS site_id UUID;
    """)
    op.execute("""
        ALTER TABLE devices ADD COLUMN IF NOT EXISTS device_group_id UUID;
    """)

    # ============================================================================
    # 4. RENAME CHIRPSTACK COLUMNS TO TTN (IF THEY STILL EXIST)
    # ============================================================================
    op.execute("""
        DO $$
        BEGIN
            -- Rename chirpstack_app_id → ttn_app_id
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'devices' AND column_name = 'chirpstack_app_id'
            ) THEN
                ALTER TABLE devices RENAME COLUMN chirpstack_app_id TO ttn_app_id;
            END IF;

            -- Rename chirpstack_synced → ttn_synced
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'devices' AND column_name = 'chirpstack_synced'
            ) THEN
                ALTER TABLE devices RENAME COLUMN chirpstack_synced TO ttn_synced;
            END IF;
        END $$;
    """)

    # Add ttn columns if they don't exist (handles case where staging already has them)
    op.execute("""
        ALTER TABLE devices ADD COLUMN IF NOT EXISTS ttn_app_id VARCHAR(100);
    """)
    op.execute("""
        ALTER TABLE devices ADD COLUMN IF NOT EXISTS ttn_synced BOOLEAN DEFAULT FALSE NOT NULL;
    """)

    # ============================================================================
    # 5. ADD FOREIGN KEY CONSTRAINTS (IF NOT EXISTS)
    # ============================================================================
    op.execute("""
        DO $$
        BEGIN
            -- FK for organization_id
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'fk_devices_organization_id'
            ) THEN
                ALTER TABLE devices
                ADD CONSTRAINT fk_devices_organization_id
                FOREIGN KEY (organization_id) REFERENCES organizations(id)
                ON DELETE SET NULL;
            END IF;

            -- FK for site_id
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'fk_devices_site_id'
            ) THEN
                ALTER TABLE devices
                ADD CONSTRAINT fk_devices_site_id
                FOREIGN KEY (site_id) REFERENCES sites(id)
                ON DELETE SET NULL;
            END IF;

            -- FK for device_group_id
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'fk_devices_device_group_id'
            ) THEN
                ALTER TABLE devices
                ADD CONSTRAINT fk_devices_device_group_id
                FOREIGN KEY (device_group_id) REFERENCES device_groups(id)
                ON DELETE SET NULL;
            END IF;
        END $$;
    """)

    # ============================================================================
    # 6. CLEAN UP DUPLICATE FK ON device_type_id
    # ============================================================================
    # Drop old ON DELETE SET NULL constraint, keep only ON DELETE RESTRICT
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'devices_device_type_id_fkey'
            ) THEN
                ALTER TABLE devices DROP CONSTRAINT devices_device_type_id_fkey;
            END IF;
        END $$;
    """)

    # ============================================================================
    # 7. RENAME OLD CHIRPSTACK INDEXES
    # ============================================================================
    op.execute("""
        DO $$
        BEGIN
            -- Rename chirpstack_app_id index
            IF EXISTS (
                SELECT 1 FROM pg_indexes
                WHERE indexname = 'idx_devices_chirpstack_app_id'
            ) THEN
                ALTER INDEX idx_devices_chirpstack_app_id RENAME TO idx_devices_ttn_app_id;
            END IF;

            -- Rename chirpstack_synced index
            IF EXISTS (
                SELECT 1 FROM pg_indexes
                WHERE indexname = 'idx_devices_chirpstack_synced'
            ) THEN
                ALTER INDEX idx_devices_chirpstack_synced RENAME TO idx_devices_ttn_synced;
            END IF;
        END $$;
    """)

    # Create indexes if they don't exist yet
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_devices_organization ON devices(organization_id);
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_devices_site ON devices(site_id);
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_devices_group ON devices(device_group_id);
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_devices_ttn_app_id ON devices(ttn_app_id);
    """)

    # ============================================================================
    # 8. UPDATE CHECK CONSTRAINT NAME (IF NEEDED)
    # ============================================================================
    # Staging has 'valid_status', model expects 'valid_device_status'
    # Drop old, create new (idempotent)
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'valid_status' AND conrelid = 'devices'::regclass
            ) THEN
                ALTER TABLE devices DROP CONSTRAINT valid_status;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'valid_device_status' AND conrelid = 'devices'::regclass
            ) THEN
                ALTER TABLE devices
                ADD CONSTRAINT valid_device_status
                CHECK (status IN ('online', 'offline', 'idle', 'error', 'provisioning'));
            END IF;
        END $$;
    """)


def downgrade() -> None:
    """
    Rollback migration - removes organizations, sites, and device hierarchy.
    WARNING: This will delete data if organizations/sites have been created!
    """
    # Drop FK constraints
    op.execute("ALTER TABLE devices DROP CONSTRAINT IF EXISTS fk_devices_organization_id;")
    op.execute("ALTER TABLE devices DROP CONSTRAINT IF EXISTS fk_devices_site_id;")
    op.execute("ALTER TABLE devices DROP CONSTRAINT IF EXISTS fk_devices_device_group_id;")

    # Drop hierarchy columns
    op.execute("ALTER TABLE devices DROP COLUMN IF EXISTS organization_id;")
    op.execute("ALTER TABLE devices DROP COLUMN IF EXISTS site_id;")
    op.execute("ALTER TABLE devices DROP COLUMN IF EXISTS device_group_id;")

    # Drop tables (CASCADE to handle foreign keys)
    op.execute("DROP TABLE IF EXISTS sites CASCADE;")
    op.execute("DROP TABLE IF EXISTS organizations CASCADE;")

    # Rename ttn columns back to chirpstack (if they were renamed)
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'devices' AND column_name = 'ttn_app_id'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'devices' AND column_name = 'chirpstack_app_id'
            ) THEN
                ALTER TABLE devices RENAME COLUMN ttn_app_id TO chirpstack_app_id;
            END IF;

            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'devices' AND column_name = 'ttn_synced'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'devices' AND column_name = 'chirpstack_synced'
            ) THEN
                ALTER TABLE devices RENAME COLUMN ttn_synced TO chirpstack_synced;
            END IF;
        END $$;
    """)
