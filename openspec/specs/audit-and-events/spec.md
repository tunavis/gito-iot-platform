## Purpose
Provides a compliance-facing audit trail of user actions and a general-purpose IoT
event stream (device lifecycle, alarm changes, custom automation events), both
queryable per tenant. Backed by `api/app/routers/audit_logs.py`, `events.py`,
`api/app/models/base.py::AuditLog`, and `api/app/models/event.py`.

## Requirements

### Requirement: Audit log API is read-only from the router's perspective, restricted to admins
The system SHALL restrict all three `audit-logs` endpoints
(`GET /audit-logs`, `GET /audit-logs/stats`, `GET /audit-logs/{id}`) to callers
whose JWT `role` is `TENANT_ADMIN` or `SUPER_ADMIN`, returning `403 Forbidden` —
"Insufficient permissions to view audit logs" otherwise. There is no `POST`
endpoint on this router.

#### Scenario: Non-admin requests audit logs
- **WHEN** a `VIEWER`/`CLIENT`/`SITE_ADMIN` calls any `GET /tenants/{id}/audit-logs*`
  endpoint
- **THEN** `403 Forbidden`, checked after the tenant-access check but before any
  query executes

### Requirement: audit_logs table has RLS and a full schema, but nothing in the reviewed codebase writes to it
The system SHALL have `audit_logs` fully modeled (`tenant_id`, `user_id`, `action`,
`resource_type`, `resource_id`, `changes` JSONB, `ip_address`, `user_agent`,
`created_at`) with the standard tenant-isolation RLS policy — but no router or
service anywhere in `api/app/` (outside `audit_logs.py`'s own read queries and the
model definition itself) constructs an `AuditLog(...)` row. There is no
audit-logging middleware, no per-mutation-endpoint logging call, and no DB trigger
populating this table from other tables' changes. The `/audit-logs` API is
fully functional for querying, but the table it queries has no known write path —
so it is effectively always empty in the current codebase.

#### Scenario: A user creates/updates/deletes a device, user, or alert rule
- **WHEN** any mutating endpoint elsewhere in the API succeeds (e.g.
  `POST /devices`, `PUT /users/{id}`, `DELETE /alarms/{id}`)
- **THEN** no corresponding `audit_logs` row is created — none of those handlers
  call `session.add(AuditLog(...))` or equivalent

### Requirement: Audit stats aggregate action/resource/user counts over a rolling window
The system SHALL, on `GET /audit-logs/stats?days=N` (1-365, default 30), compute
action-type counts, resource-type counts (excluding NULL `resource_type`), and the
top 10 most active users by row count, all filtered to `created_at >= now() - N days`.
Given the write-path gap above, this endpoint currently has no data to aggregate in
practice.

### Requirement: Events are a distinct, separate stream from audit logs — used for automation and IoT lifecycle notices, not user-action compliance
The system SHALL let `events` (model in `api/app/models/event.py`) record
`event_type`, `severity` (`INFO|WARNING|ERROR|CRITICAL`), an optional `device_id`,
free-form `message`, and a `payload` JSONB — both queryable
(`GET /tenants/{id}/events`, filterable by device/type/severity/time range) and
writable (`POST /tenants/{id}/events`, described in the router docstring as "for
automation rules, webhooks, or manual testing"). Unlike `audit_logs`, this table
DOES have a live write path via its own `POST` endpoint, though (as with
`audit_logs`) no other router in the codebase calls it to auto-emit events for
device lifecycle changes (online/offline transitions, alarm fired, etc.) — event
creation is caller-initiated only, not automatically triggered by other subsystems.

#### Scenario: Creating a custom event with no device_id
- **WHEN** `POST /events` omits `device_id`
- **THEN** the event is created as a tenant-wide (not device-specific) event;
  `device_name` in the response is `null`

#### Scenario: Listing events joins device name in one query
- **WHEN** `GET /events` is called
- **THEN** it performs a single `outerjoin` against `devices` to include
  `device_name` alongside each event, rather than N+1 lookups per event
