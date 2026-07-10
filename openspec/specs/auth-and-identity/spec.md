## Purpose
Authenticates human users (JWT-based login) and issues/validates machine credentials
(device tokens, MQTT passwords, LoRaWAN integration keys) so every other capability
can trust `tenant_id`/`user_id`/`role` claims and per-device identity. Backed by
`api/app/routers/auth.py`, `users.py`, `device_credentials.py`, `api/app/security.py`,
`api/app/dependencies.py`, and `api/app/services/tenant_access.py`.

## Requirements

### Requirement: Password-based login issues a JWT and an httpOnly cookie
The system SHALL authenticate `POST /api/v1/auth/login` by looking up `users` by
lower-cased email, verifying the bcrypt hash (`app/security.py:verify_password`),
and rejecting non-`active` accounts, then issuing a JWT (HS256, `JWT_EXPIRATION_HOURS`
TTL) containing `sub`, `tenant_id`, `tenant_type`, `role`, `email`, `name`,
`tenant_name` claims, set both in the JSON response body and as an httpOnly
`auth_token` cookie.

#### Scenario: Valid credentials
- **WHEN** `POST /auth/login` is called with a correct email/password for an
  `active` user
- **THEN** the response is `200` with `SuccessResponse(data=TokenResponse)` (the
  body IS wrapped in `{"success": true, "data": {...}}`, not returned bare) and an
  `auth_token` cookie is set with `httponly=true`, `samesite=lax`

#### Scenario: Wrong password or unknown email
- **WHEN** `POST /auth/login` is called with a bad password or an email not in `users`
- **THEN** `401 Unauthorized` — "Invalid email or password" (no distinction between
  the two cases, preventing user enumeration)

#### Scenario: Inactive account
- **WHEN** the password matches but `user.status != "active"`
- **THEN** `403 Forbidden` — "User account is inactive"

#### Scenario: Cookie secure-flag resolution
- **WHEN** the login response is built
- **THEN** the cookie's `secure` flag is resolved by `_determine_cookie_security`:
  explicit `COOKIE_SECURE` setting wins; else `X-Forwarded-Proto` header is trusted
  only if `TRUST_PROXY` is enabled; else falls back to `APP_ENV == "production"`.
  `POST /auth/refresh` does **not** use this same logic — it hardcodes
  `secure=settings.APP_ENV == "production"`, ignoring `X-Forwarded-Proto` and
  `COOKIE_SECURE` (inconsistent with `/login`).

### Requirement: Refresh token issues a new access token without re-checking password
The system SHALL, on `POST /auth/refresh`, decode the supplied token (same JWT
secret/algorithm as access tokens — there is no separate refresh-token type/claim),
re-fetch the user by `sub`, reject if missing or not `active`, and mint a new JWT +
cookie.

#### Scenario: Expired or tampered token
- **WHEN** `decode_token` raises (expired signature or invalid signature/claims)
- **THEN** `401 Unauthorized` — "Invalid or expired refresh token"

### Requirement: Logout clears the cookie only
The system SHALL, on `POST /auth/logout`, call `response.delete_cookie("auth_token")`
and return success. JWTs are stateless — no server-side token revocation/denylist
exists, so a previously-issued access token remains valid (via Authorization header)
until its `exp` even after logout.

### Requirement: JWT claims gate every protected endpoint via FastAPI dependencies
The system SHALL extract `tenant_id` (`get_current_tenant`), `(tenant_id, user_id)`
(`get_current_user`), `user_id` (`get_current_user_id`), or the full claim set
(`get_current_user_info`, including `role`) from the `Authorization: Bearer <jwt>`
header in every router, raising `401` if the header is missing/malformed or the
token fails `decode_token`. Role-based checks (e.g. "only TENANT_ADMIN/SUPER_ADMIN
may create users") read `role` directly from the JWT payload — there is no
per-request DB lookup to confirm the user's role hasn't changed or the account
hasn't been suspended since the token was issued.

#### Scenario: Missing/malformed Authorization header
- **WHEN** a protected endpoint is called without `Authorization: Bearer ...`
- **THEN** `401 Unauthorized` — "Missing or invalid Authorization header"

#### Scenario: Management-tenant-only endpoints
- **WHEN** `get_management_tenant` decodes a token whose `tenant_type` claim is not
  `"management"`
- **THEN** `403 Forbidden` — "Management tenant access required" (used by
  `admin_tenants.py` to restrict cross-tenant CRUD to Gito staff)

### Requirement: Tenant access is ancestry-aware, not strict equality
The system SHALL, in `validate_tenant_access` (`app/services/tenant_access.py`),
permit access when `current_tenant_id == target_tenant_id` (fast path, no query) OR
when the SQL function `is_ancestor_tenant(current_tenant_id, target_tenant_id)`
(added in migration `009_tenant_hierarchy`) returns true — i.e. a "management"
tenant (or any ancestor tenant) can act on a descendant client tenant's resources.
This is the actual multi-tenant boundary check used by most routers (device_groups,
sites, organizations, hierarchy, alarms, notification_rules, telemetry, dashboards,
commands, etc.) — it is **not** the plain `if str(tenant_id) != str(current_tenant_id): raise 403`
pattern documented in the project's CLAUDE.md. A minority of routers (`devices.py`
list/get/update/delete, `telemetry.py`, `device_types.py`, `alert_rules_unified.py`,
`notifications.py`, `admin_tenants.py`-adjacent) still use the plain strict-equality
check and so do **not** support management-tenant ancestry access for those specific
endpoints — an inconsistency between routers in the same codebase.

#### Scenario: Cross-tenant access denied for unrelated tenants
- **WHEN** a JWT's `tenant_id` is neither equal to nor an ancestor of the path
  `tenant_id`
- **THEN** `403 Forbidden` — "Tenant access denied" (ancestry-check routers) or
  "Tenant mismatch" (strict-equality routers)

#### Scenario: Management tenant reads a client tenant's resource
- **WHEN** a management-tenant user calls an ancestry-check-based endpoint
  (e.g. `GET /tenants/{client_id}/device-groups`) for a tenant whose
  `parent_tenant_id` is the management tenant
- **THEN** access is permitted and `session.set_tenant_context(client_id)` scopes
  the actual query to the client tenant, not the management tenant

### Requirement: RLS session context is set explicitly per request, not derived from JWT automatically
The system SHALL require every router to call `await session.set_tenant_context(tenant_id[, user_id])`
before issuing tenant-scoped queries. This executes
`SELECT set_config('app.tenant_id', ...)` and `SELECT set_config('app.current_tenant_id', ...)`
(and `app.current_user_id` when a user_id is passed) with `is_local=TRUE` (transaction-scoped,
`SET LOCAL` semantics) — see `app/database.py:RLSSession.set_tenant_context`. Because
connections are pooled (`async_sessionmaker` over `create_async_engine`), transaction
scoping matters: Postgres clears the setting automatically when the transaction ends
(commit, rollback, or connection return-to-pool), so a request that skips
`set_tenant_context` on a reused connection gets no leftover context from whichever
tenant used that connection previously. `RLSSession.commit()` is overridden to
re-apply the last-set tenant/user context immediately after committing, since routers
commonly do `commit()` followed by `refresh()`/another query on the same session
(e.g. reloading a just-created row) and that follow-up query is still within the same
logical request. `rollback()` is not overridden the same way — no router currently
queries again after a `rollback()` (it's always the last thing done before the request
ends) — if that pattern is ever introduced, `rollback()` needs the same treatment.

#### Scenario: Endpoint forgets to set tenant context
- **WHEN** a router queries an RLS-protected table without calling
  `set_tenant_context` first
- **THEN** Postgres RLS policies evaluate `current_setting('app.current_tenant_id', true)`
  against an unset/empty value for the current transaction — regardless of what a
  previous request set on that pooled connection — so the query fails closed
  (returns no rows, or errors on the implicit cast to `UUID` for policies that
  compare against `current_setting(...)::UUID`)

#### Scenario: Router commits mid-request and queries again
- **WHEN** a router calls `await session.commit()` after `set_tenant_context()` and
  then issues another query or `session.refresh()` on the same session
- **THEN** `RLSSession.commit()` has already re-run `set_tenant_context()` with the
  same tenant/user id immediately after the commit, so the follow-up query still
  runs with the correct RLS context

### Requirement: Device tokens authenticate machine ingest without a user JWT
The system SHALL let admins generate a per-device bearer token
(`POST /tenants/{tid}/devices/{did}/credentials`, prefix `gito_dt_`, 24 random bytes
hex-encoded) that is shown exactly once; only its SHA-256 hash is persisted in
`device_credentials.credential_hash` with `credential_type='device_token'`. Ingest
endpoints resolve `X-Device-Token` via the `resolve_device_token` SECURITY DEFINER
SQL function, which looks up by hash and bypasses RLS (the caller has no tenant
context yet at that point).

#### Scenario: Generate a token
- **WHEN** `POST .../credentials` is called for a device that belongs to the tenant
- **THEN** `201` with the plaintext token returned once (`DeviceTokenCreated.token`);
  subsequent `GET .../credentials` calls never return the plaintext again, only
  `id`/`name`/`status`/timestamps

#### Scenario: Revoke a token
- **WHEN** `DELETE .../credentials/{cred_id}` is called
- **THEN** `credential_hash` row's `status` flips to `revoked` and `rotated_at` is
  stamped; a device presenting that token to `/ingest` thereafter gets `401`
  (assuming `resolve_device_token` filters on `status = 'active'`)

#### Scenario: List excludes revoked tokens
- **WHEN** `GET .../credentials` is called
- **THEN** only rows with `credential_type='device_token' AND status != 'revoked'`
  are returned

### Requirement: Native MQTT ingest is NOT per-device authenticated today
The system's own MQTT broker (`eclipse-mosquitto:2.0`, see `docker-compose.yml`/
`docker-compose.staging.yml`, `mosquitto/mosquitto.conf`) SHALL run with
`allow_anonymous true` and no password file or ACL. The MQTT processor
(`processor/mqtt_processor.py`) trusts `tenant_id`/`device_id` parsed directly from
the topic string `{tenant}/devices/{device}/telemetry` and only checks that the
device row exists — it never verifies the publisher IS that device. A `device_credentials`
row with `credential_type='mqtt_password'` is defined in the schema/CHECK constraint
but there is no code path today that issues, hashes, or verifies an MQTT password —
this credential type is unused. (A design doc,
`docs/superpowers/specs/2026-07-09-mqtt-device-identity-design.md`, proposes
migrating to EMQX with PostgreSQL-backed per-device auth against exactly this
column, but it is **not implemented** — the broker is still mosquitto with anonymous
access as of the current codebase.)

#### Scenario: Any client can publish telemetry for any device today
- **WHEN** an MQTT client with no credentials connects to the platform broker and
  publishes to `{tenant_id}/devices/{device_id}/telemetry` for a `device_id` that
  exists in that tenant
- **THEN** the processor accepts and ingests the payload — there is no verification
  that the publisher is the legitimate device (cross-tenant/cross-device spoofing is
  possible on this ingest path specifically; HTTP token ingest and LoRaWAN webhook
  ingest are unaffected since they use `resolve_device_token`/`resolve_integration_key`)

### Requirement: User management enforces RBAC on create/update/delete
The system SHALL restrict `POST /tenants/{id}/users` and `POST /tenants/{id}/users/invite`
to callers whose JWT `role` is `TENANT_ADMIN` or `SUPER_ADMIN`; `PUT /users/{id}`
allows a user to edit their own profile but blocks self-changing `role`/`status`
unless the caller is an admin; `DELETE /users/{id}` (soft-delete via
`status='suspended'`) is admin-only and blocks self-deletion.

#### Scenario: Non-admin tries to create a user
- **WHEN** a `VIEWER`/`CLIENT`/`SITE_ADMIN` JWT calls `POST /users`
- **THEN** `403 Forbidden` — "Insufficient permissions to create users"

#### Scenario: Duplicate email within tenant
- **WHEN** `POST /users` or `PUT /users/{id}` sets an email that already exists for
  another user in the same tenant (`idx_users_tenant_email` unique index)
- **THEN** `409 Conflict` — "User with this email already exists"

#### Scenario: Self-deletion blocked
- **WHEN** an admin calls `DELETE /users/{own_user_id}`
- **THEN** `403 Forbidden` — "Cannot delete your own account"

#### Scenario: Invitation email is not actually sent
- **WHEN** `POST /users/invite` succeeds
- **THEN** a user row is created with `status='inactive'` and a random temporary
  password is generated and hashed, but **no email is sent** — the code has a
  `# TODO: Send invitation email` comment (`api/app/routers/users.py:252`) and the
  response only claims `invitation_sent: True`; there is no way today for the
  invited user to learn their temporary password or activate the account.

### Requirement: Password change requires the current password
The system SHALL, on `PUT /users/{id}/password`, require the caller to be changing
their own password (`current_user_info["user_id"] == user_id`, no admin override)
and verify `current_password` against the stored bcrypt hash before accepting
`new_password`.

#### Scenario: Wrong current password
- **WHEN** `current_password` does not match
- **THEN** `401 Unauthorized` — "Current password is incorrect"

#### Scenario: Attempt to change another user's password
- **WHEN** the JWT user_id differs from the path `user_id`, even for a
  `TENANT_ADMIN`
- **THEN** `403 Forbidden` — "Can only change your own password" (there is no
  admin-initiated password reset endpoint; `PUT /users/{id}` with a `password`
  field is the only admin path, which does not require the old password)
