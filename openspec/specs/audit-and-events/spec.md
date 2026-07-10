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

### Requirement: audit_logs is populated by a path-based middleware, not per-endpoint instrumentation
The system SHALL write an `AuditLog` row for every tenant-scoped mutation via
`app/middleware.py::audit_log_middleware` — registered once in `main.py`
(`app.middleware("http")(audit_log_middleware)`), not instrumented into each of
the 19+ routers individually, so a router can't silently go unaudited by
forgetting the call. For a request matching `/api/v{n}/tenants/{tenant_id}/...`
with method POST/PUT/PATCH/DELETE and a 2xx response, it derives `action` from
the HTTP method (POST→create, PUT/PATCH→update, DELETE→delete), `resource_type`
from the path segments between `tenant_id` and a trailing UUID (if any),
`resource_id` from that trailing UUID, `user_id` by re-decoding the request's
own JWT (`app.security.decode_token`), and `ip_address`/`user_agent` from the
request. `changes` (before/after diff) is NOT populated by this middleware —
capturing a real diff needs per-resource-type knowledge a generic path-based
middleware doesn't have; left empty pending a future, more targeted addition.
Failures here are logged and swallowed — audit logging must never be the
reason a real request fails. `POST /auth/login` isn't tenant-path-scoped so the
middleware can't catch it; `auth.py::login()` writes its own `action="login"`
row explicitly instead, same best-effort/non-blocking pattern.

#### Scenario: A user creates/updates/deletes a device, user, or alert rule
- **WHEN** any mutating endpoint elsewhere in the API succeeds (e.g.
  `POST /devices`, `PUT /users/{id}`, `DELETE /alarms/{id}`)
- **THEN** the middleware writes a corresponding `audit_logs` row —
  automatically, with no change needed in the endpoint itself

#### Scenario: Resource type parsing is approximate for multi-segment paths
- **WHEN** a path has no trailing UUID, e.g.
  `POST /tenants/{tid}/ota/campaigns/{cid}/execute`
- **THEN** `resource_type` becomes the verbose `"ota/campaigns/{cid}/execute"`
  (the campaign UUID isn't recognized as trailing since "execute" follows it) —
  acceptable for a best-effort audit trail, not a router-aware parser

#### Scenario: Audit write fails
- **WHEN** the DB is unreachable, or the JWT re-decode fails for any reason
- **THEN** the error is logged and swallowed; the original response is returned
  unchanged — a broken audit trail must never break the actual request

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
