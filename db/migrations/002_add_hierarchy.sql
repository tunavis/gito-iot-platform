-- ============================================================================
-- GITO IOT PLATFORM - SaaS Hierarchy Migration
-- ============================================================================
-- Adds Organizations, Sites, and Device Groups for multi-level hierarchy
-- Enables: Tenant → Organization → Site → Device Group → Device
-- Run after: 001_init.sql
-- ============================================================================

-- ============================================================================
-- SECTION 1: ORGANIZATIONS (Sub-customers within tenants)
-- ============================================================================

CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description TEXT,
    billing_contact VARCHAR(255),
    chirpstack_app_id VARCHAR(100),  -- ChirpStack Application ID mapping
    status VARCHAR(50) DEFAULT 'active' NOT NULL,
    metadata JSONB DEFAULT '{}' NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT valid_org_status CHECK (status IN ('active', 'inactive', 'suspended'))
);

CREATE INDEX IF NOT EXISTS idx_organizations_tenant ON organizations(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(tenant_id, slug);
CREATE INDEX IF NOT EXISTS idx_organizations_chirpstack ON organizations(chirpstack_app_id) 
    WHERE chirpstack_app_id IS NOT NULL;

-- Enable RLS
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS tenant_isolation ON organizations
  USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- ============================================================================
-- SECTION 2: SITES (Physical locations with nested hierarchy)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    parent_site_id UUID REFERENCES sites(id) ON DELETE CASCADE,  -- For nested sites
    name VARCHAR(255) NOT NULL,
    site_type VARCHAR(50),  -- factory, warehouse, office, building, floor, room
    address TEXT,
    coordinates JSONB,  -- {"lat": 51.5074, "lng": -0.1278}
    timezone VARCHAR(50) DEFAULT 'UTC' NOT NULL,
    metadata JSONB DEFAULT '{}' NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sites_tenant ON sites(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sites_organization ON sites(organization_id);
CREATE INDEX IF NOT EXISTS idx_sites_parent ON sites(parent_site_id);

-- Enable RLS
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS tenant_isolation ON sites
  USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- ============================================================================
-- SECTION 3: DEVICE GROUPS (Logical groupings)
-- ============================================================================

CREATE TABLE IF NOT EXISTS device_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    group_type VARCHAR(50),  -- logical, physical, functional
    membership_rule JSONB DEFAULT '{}' NOT NULL,
    attributes JSONB DEFAULT '{}' NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_groups_tenant ON device_groups(tenant_id);
CREATE INDEX IF NOT EXISTS idx_device_groups_org ON device_groups(organization_id);
CREATE INDEX IF NOT EXISTS idx_device_groups_site ON device_groups(site_id);

-- Enable RLS
ALTER TABLE device_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS tenant_isolation ON device_groups
  USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- ============================================================================
-- SECTION 4: UPDATE DEVICES TABLE (Add hierarchy foreign keys)
-- ============================================================================

-- Add hierarchy columns to devices table
ALTER TABLE devices 
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS device_group_id UUID REFERENCES device_groups(id) ON DELETE SET NULL;

-- Add indexes for hierarchy queries
CREATE INDEX IF NOT EXISTS idx_devices_organization ON devices(organization_id);
CREATE INDEX IF NOT EXISTS idx_devices_site ON devices(site_id);
CREATE INDEX IF NOT EXISTS idx_devices_group ON devices(device_group_id);

-- ============================================================================
-- SECTION 5: GROUP DEVICES (Many-to-many relationship - optional)
-- ============================================================================

CREATE TABLE IF NOT EXISTS group_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES device_groups(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    UNIQUE(group_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_group_devices_group ON group_devices(group_id);
CREATE INDEX IF NOT EXISTS idx_group_devices_device ON group_devices(device_id);

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Verify tables exist
DO $$
BEGIN
    RAISE NOTICE 'Migration 002 complete:';
    RAISE NOTICE '  - organizations table: %', 
        (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'organizations');
    RAISE NOTICE '  - sites table: %', 
        (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'sites');
    RAISE NOTICE '  - device_groups table: %', 
        (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'device_groups');
    RAISE NOTICE '  - devices hierarchy columns added';
END $$;
