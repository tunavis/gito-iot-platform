-- Migration 010a: Fix Dashboard RLS Policy Naming
-- Ensures compatibility with both app.tenant_id and app.current_tenant_id

-- The database.py now sets both app.tenant_id and app.current_tenant_id
-- for maximum compatibility across all migrations.

-- This migration is optional - it documents that we support both naming conventions
-- No actual changes needed as database.py sets both config variables

-- Original policies from 010_dashboard_system.sql already use:
-- - app.current_tenant_id (new naming)
-- - app.current_user_id (user-level RLS)

-- These are compatible with the updated RLSSession.set_tenant_context()
-- which now sets both:
-- - app.tenant_id (legacy, for older migrations)
-- - app.current_tenant_id (new, for dashboard system)
-- - app.current_user_id (when user_id parameter provided)

-- No SQL changes required - this file is for documentation only
SELECT 'Dashboard RLS policies are compatible with updated RLSSession' AS status;
