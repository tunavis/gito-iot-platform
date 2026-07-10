## Purpose
Models the customer hierarchy above devices — the management (Gito) tenant, client
tenants it provisions, and each tenant's internal Organization → Site → Device Group
structure — and provides a single rolled-up asset tree view. Backed by
`api/app/routers/admin_tenants.py`, `organizations.py`, `sites.py`, `hierarchy.py`,
and `api/app/models/organization.py`, `site.py`.

## Requirements

### Requirement: Tenants have no RLS — isolation is enforced entirely in application code
The system SHALL leave `ALTER TABLE tenants ENABLE ROW LEVEL SECURITY` absent (the
`tenants` table is intentionally excluded from the RLS policy list in both
`db/init.sql` and every Alembic migration). All tenant-scoped queries against the
`tenants` table itself (in `admin_tenants.py`, `settings.py`) rely on explicit
`WHERE` clauses (e.g. `Tenant.parent_tenant_id == management_tenant_id`) rather than
database-enforced isolation. This matches the project's documented convention
("tenants — no RLS") but means a missing `WHERE` clause on this one table is not
caught by any database-level safety net.

#### Scenario: Management tenant lists only its own children
- **WHEN** `GET /admin/tenants` is called with a management-tenant JWT
- **THEN** the query filters `Tenant.parent_tenant_id == management_tenant_id`
  explicitly in Python — omitting this filter would return every tenant in the
  database, since RLS does not protect this table

### Requirement: Tenant hierarchy is two-level via a self-referencing FK
The system SHALL support `tenants.parent_tenant_id` (nullable, `ON DELETE RESTRICT`,
added in migration `009_tenant_hierarchy`) and `tenants.tenant_type` (`management` |
`client` | `sub_client`, default `client`). The oldest tenant in the database is
seeded as `tenant_type='management'` by that migration. `is_ancestor_tenant(ancestor, descendant)`
is a recursive SQL function walking `parent_tenant_id` for arbitrary depth, though
only management→client is actually created by application code today (no endpoint
creates a `sub_client` or sets a client tenant's `parent_tenant_id` to another client).

#### Scenario: Creating a client tenant
- **WHEN** a management-tenant admin calls `POST /admin/tenants` with `name`, `slug`,
  `admin_email`, `admin_name`
- **THEN** a new `Tenant` row is created with `parent_tenant_id = management_tenant_id`,
  `tenant_type='client'` (or `sub_client` if requested), plus a first `User` row with
  `role='TENANT_ADMIN'`, `status='active'`; the response returns the auto-generated
  (or caller-supplied) plaintext admin password exactly once
  (`CreateTenantResponse.admin_password`) — it is never stored in plaintext, only
  `hash_password()`'d

#### Scenario: Slug collision
- **WHEN** `POST /admin/tenants` supplies a `slug` that already exists (global unique
  constraint on `tenants.slug`)
- **THEN** `400 Bad Request` — "Slug '<slug>' is already taken"

#### Scenario: Tenant summary counts bypass RLS via raw SQL
- **WHEN** `_tenant_summary()` computes `device_count`/`user_count`/`active_alarms`
  for a listed tenant
- **THEN** it issues raw `text("SELECT count(*) FROM devices WHERE tenant_id = :tid")`
  style queries rather than ORM `select()` — these tables DO have RLS, but the
  session's `app.current_tenant_id` was just set to the **management** tenant's ID
  (`SET LOCAL app.current_tenant_id = :tid` in the endpoint), so a plain
  `select(Device).where(...)` would be blocked by RLS; raw SQL with an explicit
  `tenant_id = :tid` filter is used specifically to read across tenant boundaries
  that RLS would otherwise block for the management tenant's own session context

### Requirement: Organizations are sub-customers scoped to a tenant, with a tenant-unique slug
The system SHALL enforce `(tenant_id, slug)` uniqueness for `organizations`
(`idx_organizations_slug` unique index) and standard RLS
(`organizations_tenant_isolation`). `chirpstack_app_id` is an optional field linking
an org to a ChirpStack application for LoRaWAN provisioning.

#### Scenario: Duplicate slug within tenant
- **WHEN** `POST /tenants/{id}/organizations` supplies a `slug` already used by
  another organization in the same tenant
- **THEN** `400 Bad Request` — "Organization with slug '<slug>' already exists"
  (note: this is `400`, not the `409 Conflict` used for the equivalent device/user
  duplicate-key cases elsewhere in the codebase — an inconsistency in status code
  choice for the same class of error)

### Requirement: Sites form a self-referencing tree scoped to an organization
The system SHALL support `sites.parent_site_id` (nullable FK to `sites.id`,
`ON DELETE CASCADE`) for nested sites (e.g. campus → building → floor), each site
belonging to exactly one `organization_id` (required, `ON DELETE CASCADE`). Deleting
a parent site cascades to delete all descendant sites (via the FK's `ON DELETE CASCADE`,
not application logic).

#### Scenario: Create a site with a non-existent parent
- **WHEN** `POST /tenants/{id}/sites` supplies a `parent_site_id` that doesn't exist
  in the tenant
- **THEN** `404 Not Found` — "Parent site not found" (checked explicitly before
  insert, since the child endpoint validates rather than relying on the FK
  constraint's error)

#### Scenario: List devices at a site
- **WHEN** `GET /tenants/{id}/sites/{site_id}/devices` is called
- **THEN** devices are matched purely on `Device.site_id == site_id` — a device
  physically inside a child site of this site is NOT included (no recursive
  descendant lookup); only `GET /sites/{id}/children` exposes the direct-child
  relationship, and it is not recursive either (one level only)

### Requirement: Hierarchy endpoint assembles Org→Site→DeviceGroup tree with rollups in 5 flat queries
The system SHALL, on `GET /tenants/{id}/hierarchy`, avoid N+1 queries by fetching
all organizations, all sites, all device groups, one grouped device-count query
(total + online, grouped by org/site/group), and one grouped active-alarm-count
query (`Alarm.status IN ('ACTIVE','ACKNOWLEDGED')`, joined to `Device`), then
assembling the nested tree and rollups in Python.

#### Scenario: Device with no organization/site/group
- **WHEN** a device has `organization_id`, `site_id`, and `device_group_id` all NULL
- **THEN** it is not counted in any node's `device_count` in the hierarchy response
  (the rollup only aggregates devices that have a non-null FK at each level) —
  such "unassigned" devices are invisible in this view entirely

#### Scenario: Multi-level nested sites
- **WHEN** sites form a 3-level chain (site A → child B → grandchild C, all same org)
- **THEN** `build_sites()` recurses on `parent_site_id`, so C appears nested under B
  under A in the `sites[].children[]` array, each with its own rolled-up
  `device_count`/`online_count`/`active_alarms`
