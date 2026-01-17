-- ============================================================================
-- GITO IOT PLATFORM - Hierarchy Seed Data
-- ============================================================================
-- Creates default organization and site for existing tenants
-- Links existing devices to default hierarchy
-- Ensures backward compatibility
-- ============================================================================

-- ============================================================================
-- SECTION 1: CREATE DEFAULT ORGANIZATIONS
-- ============================================================================

-- Create default organization for each existing tenant
INSERT INTO organizations (id, tenant_id, name, slug, status, description)
SELECT 
    gen_random_uuid(),
    t.id,
    t.name || ' - Default Organization',
    t.slug || '-default',
    'active',
    'Default organization created during hierarchy migration'
FROM tenants t
WHERE NOT EXISTS (
    SELECT 1 FROM organizations o WHERE o.tenant_id = t.id
);

-- ============================================================================
-- SECTION 2: CREATE DEFAULT SITES
-- ============================================================================

-- Create default site for each organization
INSERT INTO sites (id, tenant_id, organization_id, name, site_type, timezone)
SELECT 
    gen_random_uuid(),
    o.tenant_id,
    o.id,
    'Main Site',
    'headquarters',
    'UTC'
FROM organizations o
WHERE NOT EXISTS (
    SELECT 1 FROM sites s WHERE s.organization_id = o.id
);

-- ============================================================================
-- SECTION 3: LINK EXISTING DEVICES TO HIERARCHY
-- ============================================================================

-- Update existing devices to belong to default org/site
UPDATE devices d
SET 
    organization_id = (
        SELECT o.id 
        FROM organizations o 
        WHERE o.tenant_id = d.tenant_id 
        LIMIT 1
    ),
    site_id = (
        SELECT s.id 
        FROM sites s 
        WHERE s.tenant_id = d.tenant_id 
        LIMIT 1
    )
WHERE d.organization_id IS NULL;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
    org_count INTEGER;
    site_count INTEGER;
    linked_devices INTEGER;
    unlinked_devices INTEGER;
BEGIN
    SELECT COUNT(*) INTO org_count FROM organizations;
    SELECT COUNT(*) INTO site_count FROM sites;
    SELECT COUNT(*) INTO linked_devices FROM devices WHERE organization_id IS NOT NULL;
    SELECT COUNT(*) INTO unlinked_devices FROM devices WHERE organization_id IS NULL;
    
    RAISE NOTICE 'Hierarchy seed data complete:';
    RAISE NOTICE '  - Organizations created: %', org_count;
    RAISE NOTICE '  - Sites created: %', site_count;
    RAISE NOTICE '  - Devices linked to hierarchy: %', linked_devices;
    RAISE NOTICE '  - Devices still unlinked: %', unlinked_devices;
    
    IF unlinked_devices > 0 THEN
        RAISE WARNING 'Some devices are not linked to hierarchy. Manual intervention may be required.';
    END IF;
END $$;
