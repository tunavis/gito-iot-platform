"""strict_hierarchy_and_rls

Enforce strict SaaS hierarchy: Tenant → Organization → Site → DeviceGroup → Device.
Add RLS to organizations and sites tables.
Add updated_at triggers for organizations and sites.
Backfill NULL hierarchy fields with a default org/site/group.

Revision ID: b5f1a9c23d71
Revises: a39ec742656a
Create Date: 2026-02-08 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b5f1a9c23d71'
down_revision: Union[str, None] = 'a39ec742656a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # =====================================================================
    # 1. ROW LEVEL SECURITY — organizations & sites
    # =====================================================================
    op.execute("ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation_organizations ON organizations
        USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
    """)

    op.execute("ALTER TABLE sites ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation_sites ON sites
        USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
    """)

    # =====================================================================
    # 2. updated_at TRIGGERS — organizations & sites
    # =====================================================================
    # The trigger function already exists from init.sql / earlier migrations
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_trigger WHERE tgname = 'set_organizations_updated_at'
            ) THEN
                CREATE TRIGGER set_organizations_updated_at
                    BEFORE UPDATE ON organizations
                    FOR EACH ROW
                    EXECUTE FUNCTION update_updated_at_column();
            END IF;
        END $$;
    """)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_trigger WHERE tgname = 'set_sites_updated_at'
            ) THEN
                CREATE TRIGGER set_sites_updated_at
                    BEFORE UPDATE ON sites
                    FOR EACH ROW
                    EXECUTE FUNCTION update_updated_at_column();
            END IF;
        END $$;
    """)

    # =====================================================================
    # 3. BACKFILL — Create default hierarchy entities per tenant
    #    For every tenant that has devices with NULL org/site/group:
    #      - Create "Default Organization"
    #      - Create "Default Site" under that org
    #      - Create "Default Group" under that site
    #    Then fill in the NULLs.
    # =====================================================================

    # 3a. Create default organization per tenant where devices have NULL org
    op.execute("""
        INSERT INTO organizations (id, tenant_id, name, slug, status, attributes, created_at, updated_at)
        SELECT
            gen_random_uuid(),
            d.tenant_id,
            'Default Organization',
            'default',
            'active',
            '{}',
            NOW(),
            NOW()
        FROM devices d
        WHERE d.organization_id IS NULL
        GROUP BY d.tenant_id
        ON CONFLICT DO NOTHING;
    """)

    # 3b. Backfill devices: set organization_id to the 'default' org for their tenant
    op.execute("""
        UPDATE devices d
        SET organization_id = o.id
        FROM organizations o
        WHERE o.tenant_id = d.tenant_id
          AND o.slug = 'default'
          AND d.organization_id IS NULL;
    """)

    # 3c. Create default site per tenant under the default org
    op.execute("""
        INSERT INTO sites (id, tenant_id, organization_id, name, site_type, timezone, attributes, created_at, updated_at)
        SELECT
            gen_random_uuid(),
            o.tenant_id,
            o.id,
            'Default Site',
            'default',
            'UTC',
            '{}',
            NOW(),
            NOW()
        FROM organizations o
        WHERE o.slug = 'default'
          AND NOT EXISTS (
              SELECT 1 FROM sites s WHERE s.organization_id = o.id AND s.name = 'Default Site'
          );
    """)

    # 3d. Backfill devices: set site_id to the 'Default Site' for their org
    op.execute("""
        UPDATE devices d
        SET site_id = s.id
        FROM sites s
        WHERE s.organization_id = d.organization_id
          AND s.name = 'Default Site'
          AND d.site_id IS NULL;
    """)

    # 3e. Handle devices that have a site but the site's org doesn't match device's org
    #     (fix any inconsistencies before enforcing NOT NULL)
    op.execute("""
        UPDATE devices d
        SET organization_id = s.organization_id
        FROM sites s
        WHERE s.id = d.site_id
          AND d.organization_id != s.organization_id;
    """)

    # 3f. Create default device group per site where devices have NULL group
    op.execute("""
        INSERT INTO device_groups (id, tenant_id, organization_id, site_id, name, group_type, membership_rule, attributes, created_at, updated_at)
        SELECT
            gen_random_uuid(),
            d.tenant_id,
            d.organization_id,
            d.site_id,
            'Default Group',
            'default',
            '{}',
            '{}',
            NOW(),
            NOW()
        FROM devices d
        WHERE d.device_group_id IS NULL
        GROUP BY d.tenant_id, d.organization_id, d.site_id
        ON CONFLICT DO NOTHING;
    """)

    # 3g. Backfill devices: set device_group_id to the 'Default Group' for their site
    op.execute("""
        UPDATE devices d
        SET device_group_id = dg.id
        FROM device_groups dg
        WHERE dg.site_id = d.site_id
          AND dg.name = 'Default Group'
          AND d.device_group_id IS NULL;
    """)

    # 3h. Backfill device_groups: fill NULL organization_id and site_id
    #     Groups with org but no site — assign first site under that org
    op.execute("""
        UPDATE device_groups dg
        SET site_id = (
            SELECT s.id FROM sites s
            WHERE s.organization_id = dg.organization_id
            ORDER BY s.created_at
            LIMIT 1
        )
        WHERE dg.site_id IS NULL
          AND dg.organization_id IS NOT NULL;
    """)

    # Groups with no org — assign the default org for their tenant
    op.execute("""
        UPDATE device_groups dg
        SET organization_id = o.id
        FROM organizations o
        WHERE o.tenant_id = dg.tenant_id
          AND o.slug = 'default'
          AND dg.organization_id IS NULL;
    """)

    # Groups still with no site — assign default site under their org
    op.execute("""
        UPDATE device_groups dg
        SET site_id = s.id
        FROM sites s
        WHERE s.organization_id = dg.organization_id
          AND s.name = 'Default Site'
          AND dg.site_id IS NULL;
    """)

    # =====================================================================
    # 4. ENFORCE NOT NULL — make hierarchy columns mandatory
    # =====================================================================

    # Device: organization_id, site_id, device_group_id must NOT be NULL
    op.alter_column('devices', 'organization_id', nullable=False)
    op.alter_column('devices', 'site_id', nullable=False)
    op.alter_column('devices', 'device_group_id', nullable=False)

    # DeviceGroup: organization_id, site_id must NOT be NULL
    op.alter_column('device_groups', 'organization_id', nullable=False)
    op.alter_column('device_groups', 'site_id', nullable=False)

    # =====================================================================
    # 5. Change FK actions from SET NULL to RESTRICT — prevent orphans
    # =====================================================================

    # Devices: Change SET NULL FKs to RESTRICT
    op.drop_constraint('devices_organization_id_fkey', 'devices', type_='foreignkey')
    op.create_foreign_key(
        'devices_organization_id_fkey', 'devices', 'organizations',
        ['organization_id'], ['id'], ondelete='RESTRICT'
    )

    op.drop_constraint('devices_site_id_fkey', 'devices', type_='foreignkey')
    op.create_foreign_key(
        'devices_site_id_fkey', 'devices', 'sites',
        ['site_id'], ['id'], ondelete='RESTRICT'
    )

    op.drop_constraint('devices_device_group_id_fkey', 'devices', type_='foreignkey')
    op.create_foreign_key(
        'devices_device_group_id_fkey', 'devices', 'device_groups',
        ['device_group_id'], ['id'], ondelete='RESTRICT'
    )

    # =====================================================================
    # 6. HIERARCHY CONSISTENCY TRIGGER — auto-inherit org/site from group
    # =====================================================================
    op.execute("""
        CREATE OR REPLACE FUNCTION enforce_device_hierarchy()
        RETURNS TRIGGER AS $$
        DECLARE
            grp_org_id UUID;
            grp_site_id UUID;
        BEGIN
            -- When device_group_id is set, auto-inherit org + site from the group
            IF NEW.device_group_id IS NOT NULL THEN
                SELECT organization_id, site_id
                INTO grp_org_id, grp_site_id
                FROM device_groups
                WHERE id = NEW.device_group_id;

                IF grp_org_id IS NOT NULL THEN
                    NEW.organization_id := grp_org_id;
                END IF;
                IF grp_site_id IS NOT NULL THEN
                    NEW.site_id := grp_site_id;
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)

    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_trigger WHERE tgname = 'enforce_device_hierarchy_trigger'
            ) THEN
                CREATE TRIGGER enforce_device_hierarchy_trigger
                    BEFORE INSERT OR UPDATE ON devices
                    FOR EACH ROW
                    EXECUTE FUNCTION enforce_device_hierarchy();
            END IF;
        END $$;
    """)

    # Similarly for device_groups — auto-inherit org from site
    op.execute("""
        CREATE OR REPLACE FUNCTION enforce_group_hierarchy()
        RETURNS TRIGGER AS $$
        DECLARE
            site_org_id UUID;
        BEGIN
            IF NEW.site_id IS NOT NULL THEN
                SELECT organization_id
                INTO site_org_id
                FROM sites
                WHERE id = NEW.site_id;

                IF site_org_id IS NOT NULL THEN
                    NEW.organization_id := site_org_id;
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)

    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_trigger WHERE tgname = 'enforce_group_hierarchy_trigger'
            ) THEN
                CREATE TRIGGER enforce_group_hierarchy_trigger
                    BEFORE INSERT OR UPDATE ON device_groups
                    FOR EACH ROW
                    EXECUTE FUNCTION enforce_group_hierarchy();
            END IF;
        END $$;
    """)


def downgrade() -> None:
    # Remove triggers
    op.execute("DROP TRIGGER IF EXISTS enforce_device_hierarchy_trigger ON devices;")
    op.execute("DROP FUNCTION IF EXISTS enforce_device_hierarchy();")
    op.execute("DROP TRIGGER IF EXISTS enforce_group_hierarchy_trigger ON device_groups;")
    op.execute("DROP FUNCTION IF EXISTS enforce_group_hierarchy();")

    # Revert FK constraints back to SET NULL
    op.drop_constraint('devices_organization_id_fkey', 'devices', type_='foreignkey')
    op.create_foreign_key(
        'devices_organization_id_fkey', 'devices', 'organizations',
        ['organization_id'], ['id'], ondelete='SET NULL'
    )
    op.drop_constraint('devices_site_id_fkey', 'devices', type_='foreignkey')
    op.create_foreign_key(
        'devices_site_id_fkey', 'devices', 'sites',
        ['site_id'], ['id'], ondelete='SET NULL'
    )
    op.drop_constraint('devices_device_group_id_fkey', 'devices', type_='foreignkey')
    op.create_foreign_key(
        'devices_device_group_id_fkey', 'devices', 'device_groups',
        ['device_group_id'], ['id'], ondelete='SET NULL'
    )

    # Make columns nullable again
    op.alter_column('devices', 'organization_id', nullable=True)
    op.alter_column('devices', 'site_id', nullable=True)
    op.alter_column('devices', 'device_group_id', nullable=True)
    op.alter_column('device_groups', 'organization_id', nullable=True)
    op.alter_column('device_groups', 'site_id', nullable=True)

    # Remove triggers
    op.execute("DROP TRIGGER IF EXISTS set_organizations_updated_at ON organizations;")
    op.execute("DROP TRIGGER IF EXISTS set_sites_updated_at ON sites;")

    # Remove RLS
    op.execute("DROP POLICY IF EXISTS tenant_isolation_organizations ON organizations;")
    op.execute("ALTER TABLE organizations DISABLE ROW LEVEL SECURITY;")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_sites ON sites;")
    op.execute("ALTER TABLE sites DISABLE ROW LEVEL SECURITY;")
