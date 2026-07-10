## Purpose
Exposes a tenant's editable profile (name, contact, timezone, retention policy,
integration defaults) as a single flattened view over the `tenants` row plus its
`metadata` JSONB blob. Backed by `api/app/routers/settings.py`.

## Requirements

### Requirement: Tenant profile fields beyond name/slug/status are stored in the tenants.metadata JSONB column, not dedicated columns
The system SHALL persist `contact_email`, `timezone`, `retention_days`, and
`integrations` (SMTP host/port/user/from) inside `tenants.metadata` (mapped to the
SQLAlchemy attribute `tenant_metadata`, since `metadata` is a reserved name — added
by migration `007_tenant_metadata_and_events`), merging new values into the existing
dict on `PUT` rather than replacing it wholesale, and re-assigning the attribute
explicitly (`tenant.tenant_metadata = meta`) because SQLAlchemy does not
automatically track in-place mutations of JSONB-backed dict attributes.

#### Scenario: Partial update preserves untouched metadata fields
- **WHEN** `PUT /tenants/{id}/settings/profile` is called with only `{"timezone": "Africa/Johannesburg"}`
- **THEN** `contact_email`, `retention_days`, and `integrations` already stored in
  `metadata` are preserved unchanged — only `timezone` is overwritten, because the
  handler starts from a copy of the existing dict and merges in only the
  fields present in the request

#### Scenario: retention_days is enforced by a separate scheduled job, not this router
- **WHEN** a tenant sets `retention_days` via this endpoint (validated `7 <= n <= 3650`)
- **THEN** the value is persisted in `metadata`; this router itself does not delete
  any data, but `NotificationBackgroundTasks.enforce_telemetry_retention()`
  (`api/app/services/background_tasks.py:305-354`, scheduled every 6 hours) reads
  `metadata->>'retention_days'` per active tenant (defaulting to 90 days if unset)
  and issues per-tenant `DELETE FROM telemetry WHERE tenant_id = :tid AND ts < cutoff`
  plus the equivalent for `events`, relying on TimescaleDB chunk pruning for
  performance

### Requirement: Tenant settings bypass RLS on purpose, since tenants has none
The system SHALL query `Tenant` directly by `id` with no `set_tenant_context()` call
(the router comment states explicitly: "Tenants table has no RLS so we query
directly") — isolation is enforced solely by the preceding
`validate_tenant_access()` ancestry check plus the explicit `Tenant.id == tenant_id`
filter.

#### Scenario: Tenant not found
- **WHEN** `tenant_id` in the path doesn't match any row (e.g. a stale/garbage UUID
  that nonetheless passes the ancestry check because it's the caller's own tenant_id
  which was just deleted)
- **THEN** `404 Not Found` — "Tenant not found"
