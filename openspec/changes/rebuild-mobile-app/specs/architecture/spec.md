## MODIFIED Requirements

### Requirement: Confirmed tech stack versions
The system SHALL run: API — Python `>=3.11`, `fastapi==0.104.1`,
`sqlalchemy[asyncio]==2.0.23` (`api/pyproject.toml`); Processor —
`aiomqtt>=2.4.0`, `psycopg[binary]>=3.1.0` (async, `psycopg_pool`),
`redis[asyncio]>=5.0.0` (`processor/requirements.txt`); Web — Next.js `^14.0.3`,
React `^18.2.0`, TypeScript `^5.3.3`, `react-grid-layout@^1.4.4` (pinned old, see
`CLEANUP_TODO.md`), `recharts@^2.15.4`, `leaflet`/`react-leaflet`
(`web/package.json`); Mobile — Expo SDK with React Native and TypeScript,
targeting iOS and Android only, with `expo-router` for navigation,
`@tanstack/react-query` for server state, `expo-secure-store` for the access
token, and `react-native-reanimated` / `expo-blur` / `expo-haptics` for the
interaction layer (`mobile/package.json`); Database —
`timescale/timescaledb:latest-pg16` in dev, `timescale/timescaledb:latest-pg15`
in staging (version mismatch between environments).

#### Scenario: Someone checks whether the dashboard grid library has been upgraded
- **WHEN** inspecting `web/package.json`
- **THEN** `react-grid-layout` is still `^1.4.4`, matching the intentional-old-version note in root `CLAUDE.md` and the `TODO` comment at `web/src/components/DashboardBuilder/DashboardGrid.tsx:3-5`

#### Scenario: Someone checks what the mobile client is built with
- **WHEN** inspecting `mobile/package.json`
- **THEN** it is an Expo/React Native TypeScript app, not Flutter/Dart — the
  Flutter app it replaced was never version-controlled (`.gitignore` carried
  `mobile/`) and was deleted; exact dependency versions live in that manifest
  rather than being restated here, because pinning them in a spec is what made
  this requirement stale in the first place

### Requirement: Three communication protocols are in active use, each for a distinct purpose
The system SHALL use: REST (FastAPI, tenant-scoped `/api/v1/tenants/{id}/...`) for all CRUD and query operations from both web and mobile; WebSocket for real-time push — tenant-scoped (`/api/v1/ws/tenants/{id}/telemetry`, used by the web dashboard grid) and device-scoped (`/api/v1/ws/devices/{id}`, used by the web device-detail hook and mirrored by the mobile client) — both fronted through nginx's `/api/v1/ws/` location with extended timeouts; and MQTT for device-to-platform telemetry ingest via Mosquitto, plus processor-to-customer-broker bridging for LoRaWAN.

#### Scenario: A dashboard widget needs a live value
- **WHEN** the dashboard is open in view mode
- **THEN** it relies on the tenant-scoped WebSocket (`useDashboardWebSocket`) rather than polling; edit mode disables the WebSocket and shows static data instead
