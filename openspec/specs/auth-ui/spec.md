## Purpose
Covers the web login flow, the dual token-storage pattern (httpOnly cookie + localStorage), and the Next.js middleware that gates `/dashboard/*` page access. Implemented in `web/src/app/auth/login/page.tsx` and `web/src/middleware.ts`.

## Requirements

### Requirement: Login stores the JWT in both an httpOnly cookie and localStorage
The system SHALL, on successful login, have the client call `POST /api/v1/auth/login` with `credentials: "include"`, then store `data.data.access_token` in `localStorage["auth_token"]` for client-side fetches, while the *backend* additionally sets an httpOnly `Set-Cookie` (not the Next.js API route — see deviation below) that `middleware.ts` reads for page-route protection.

#### Scenario: Successful login
- **WHEN** `POST /api/v1/auth/login` returns `{data: {access_token, ...}}`
- **THEN** the token is saved to `localStorage` and the page does a full navigation (`window.location.href = '/dashboard'`) rather than a client-side route push

#### Scenario: Login fails
- **WHEN** the response is non-OK
- **THEN** `data.error?.message` (falling back to `"Login failed"`) is shown inline and the form remains interactive (loading state cleared)

### Requirement: Middleware gates dashboard page routes on a verifiable JWT cookie
The system SHALL, per `web/src/middleware.ts` matcher (`/dashboard/:path*`, `/api/tenants/:path*`), read `auth_token` from the request cookie, verify it with `jose.jwtVerify` against `JWT_SECRET_KEY`, and redirect to `/auth/login` (clearing the cookie) if the cookie is missing or verification fails.

#### Scenario: No cookie present
- **WHEN** a user requests `/dashboard` without an `auth_token` cookie
- **THEN** middleware redirects to `/auth/login` before the page renders

#### Scenario: Cookie present but signature invalid or expired
- **WHEN** `jwtVerify` throws
- **THEN** middleware deletes the `auth_token` cookie and redirects to `/auth/login`

#### Scenario: Valid cookie
- **WHEN** verification succeeds
- **THEN** middleware injects `x-tenant-id`, `x-user-id`, `x-user-role`, and `authorization: Bearer <token>` headers onto the forwarded request (consumed by any Next.js route handler downstream — see deviation)

### Requirement: Client-side API calls derive tenant context by decoding the JWT locally, not from cookies
The system SHALL have client components read `localStorage["auth_token"]`, base64-decode the JWT payload themselves (`JSON.parse(atob(token.split(".")[1]))`), and extract `tenant_id` per-call — this is the pattern repeated across `DashboardGrid`, `DeviceBindingModal`, and the connections/device-types pages, matching the pattern documented in root `CLAUDE.md`.

#### Scenario: Token missing or malformed
- **WHEN** `localStorage.getItem('auth_token')` is null or the payload fails to parse
- **THEN** the calling component treats auth as absent (empty tenantId, no request fired, or redirect to login depending on the call site) rather than throwing an unhandled exception

### Requirement: All real API traffic reaches FastAPI directly through nginx, bypassing the Next.js API-route layer
The system SHALL route every `/api/*` request through `nginx`'s `location /api/` block straight to the `api_backend` (FastAPI) upstream (`nginx/nginx.conf`); Next.js API route handlers under `web/src/app/api/` are therefore not on the request path for any URL the frontend actually calls.

#### Scenario: Login request in the deployed (nginx-fronted) topology
- **WHEN** the login page fetches `/api/v1/auth/login`
- **THEN** nginx forwards it directly to FastAPI — the Next.js route handler at `web/src/app/api/auth/login/route.ts` (mounted at the different path `/api/auth/login`, no `/v1`) is never invoked in this deployment; the httpOnly cookie described in CLAUDE.md's auth pattern is set by FastAPI itself

#### Scenario: A request targets `/api/tenants/{id}/devices`
- **WHEN** the frontend or middleware would route through
  `web/src/app/api/tenants/[tenant_id]/devices/route.ts` (folder name fixed —
  was literally `[tenant_id/]`, a `/` embedded inside the segment name itself,
  which made Next.js unable to recognize it as a dynamic route at all)
- **THEN** it's now a structurally valid Next.js route, but still never runs in
  the deployed topology (nginx never forwards `/api/*` to the Next.js
  container), and no frontend code calls this relative path anyway (checked:
  nothing fetches `/api/tenants/...`) — kept as-is rather than deleted pending
  a decision on the whole `web/src/app/api/` layer's future
