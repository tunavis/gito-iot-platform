## Purpose
The overall Gito IoT Platform system: a multi-tenant SaaS stack of a FastAPI backend, a standalone MQTT processor microservice, a Next.js 14 web frontend, and a Flutter mobile app, sharing one TimescaleDB/PostgreSQL database. This spec grounds the real tech stack versions, the two device-ingest data paths, the three communication protocols in use, and the actual staging deployment mechanism.

> How the platform is meant to be *extended* beyond current behavior — the
> Integrations (connectors) vs Modules (vertical solution packs) decision, and the
> contract a new one must honor — is recorded in
> [ADR-003](../../../docs/adr/003-modules-vs-integrations-extensibility.md). Nothing
> there is built yet; it exists so future work slots in without hacking this core.

## Requirements

### Requirement: Confirmed tech stack versions
The system SHALL run: API — Python `>=3.11`, `fastapi==0.104.1`, `sqlalchemy[asyncio]==2.0.23` (`api/pyproject.toml`); Processor — `aiomqtt>=2.4.0`, `psycopg[binary]>=3.1.0` (async, `psycopg_pool`), `redis[asyncio]>=5.0.0` (`processor/requirements.txt`); Web — Next.js `^14.0.3`, React `^18.2.0`, TypeScript `^5.3.3`, `react-grid-layout@^1.4.4` (pinned old, see `CLEANUP_TODO.md`), `recharts@^2.15.4`, `leaflet`/`react-leaflet` (`web/package.json`); Mobile — Flutter SDK `>=3.5.0 <4.0.0`, `flutter_bloc@^8.1.5`, `go_router@^13.2.0`, `dio@^5.4.1` (`mobile/pubspec.yaml`); Database — `timescale/timescaledb:latest-pg16` in dev, `timescale/timescaledb:latest-pg15` in staging (version mismatch between environments).

#### Scenario: Someone checks whether the dashboard grid library has been upgraded
- **WHEN** inspecting `web/package.json`
- **THEN** `react-grid-layout` is still `^1.4.4`, matching the intentional-old-version note in root `CLAUDE.md` and the `TODO` comment at `web/src/components/DashboardBuilder/DashboardGrid.tsx:3-5`

### Requirement: Two independent, differently-authenticated device-ingest paths feed the same telemetry table
The system SHALL accept device data via (1) MQTT — devices/bridges publish to Mosquitto, `processor/mqtt_processor.py`'s `MQTTProcessor` (subscribed via `aiomqtt`) validates/deduplicates, `XADD`s to a KeyDB stream `telemetry:ingest`, and a separate `StreamConsumer` asyncio task batches `INSERT INTO telemetry` per tenant; and (2) HTTP — `POST /api/v1/ingest/lorawan/{provider}` (`api/app/routers/lorawan_ingest.py`), a FastAPI router invoked directly by network-server webhooks (ChirpStack, TTN, etc.), authenticated per-integration, bypassing Mosquitto and the processor entirely.

#### Scenario: A ChirpStack webhook integration delivers an uplink
- **WHEN** ChirpStack POSTs to the tenant's webhook URL
- **THEN** it hits `lorawan_ingest.py`'s `/ingest/lorawan/{provider}` route directly in the API container — no MQTT broker or processor involvement

#### Scenario: A device publishes over MQTT (native or via `chirpstack_mqtt` bridge)
- **WHEN** a message lands on the platform's Mosquitto broker
- **THEN** `MQTTProcessor` reads it, and per its own docstring at `processor/mqtt_processor.py:6-18`, the path is: validate → `XADD telemetry:ingest` (KeyDB) → Redis pub/sub publish (for WebSocket fan-out) → inline alert-rule evaluation, with the actual TimescaleDB `INSERT` happening asynchronously in a batching `StreamConsumer`, not inline with the MQTT callback

### Requirement: Outbound customer-broker bridging is separate from the platform's own inbound broker
The system SHALL, via `processor/mqtt_processor.py`'s `BridgeWorker` class (line 888), connect outbound from the processor to a *customer's* ChirpStack MQTT broker as a subscriber — this is Python application code, not a broker-to-broker bridge configured in Mosquitto itself, so replacing the platform broker does not require touching this component.

#### Scenario: A tenant configures a `chirpstack_mqtt` connection
- **WHEN** the integration is created (see `connections-ui` spec)
- **THEN** `BridgeWorker` opens an outbound connection to the customer's broker using stored credentials and republishes decoded uplinks into the platform's own ingest path

### Requirement: Three communication protocols are in active use, each for a distinct purpose
The system SHALL use: REST (FastAPI, tenant-scoped `/api/v1/tenants/{id}/...`) for all CRUD and query operations from both web and mobile; WebSocket for real-time push — tenant-scoped (`/api/v1/ws/tenants/{id}/telemetry`, used by the web dashboard grid) and device-scoped (`/api/v1/ws/devices/{id}`, used by the web device-detail hook and mirrored by the mobile `DeviceWebSocketClient`) — both fronted through nginx's `/api/v1/ws/` location with extended timeouts; and MQTT for device-to-platform telemetry ingest via Mosquitto, plus processor-to-customer-broker bridging for LoRaWAN.

#### Scenario: A dashboard widget needs a live value
- **WHEN** the dashboard is open in view mode
- **THEN** it relies on the tenant-scoped WebSocket (`useDashboardWebSocket`) rather than polling; edit mode disables the WebSocket and shows static data instead

### Requirement: Staging deployment pulls pre-built images over SSH, not a build-on-server flow
The system SHALL deploy staging by SSHing into a fixed host (`mark@192.168.0.9`, `/opt/gito-iot`, per `deploy-staging.ps1`), running `git pull origin staging`, then `docker compose -f docker-compose.staging.yml down/pull/up -d` — pulling pre-built images `ghcr.io/tunavis/gito-iot-platform-{api,web}:staging` rather than building from source on the staging host (the `processor` service is the exception: it's still `build:`-based even in `docker-compose.staging.yml`).

#### Scenario: A change to `web/` or `api/` is deployed
- **WHEN** CI builds and pushes new `:staging` tagged images to GHCR
- **THEN** `deploy-staging.ps1` only pulls and restarts — it does not run a build step for `api` or `web` on the staging host itself

### Requirement: The platform's own MQTT broker currently runs with no device authentication, and a documented redesign (EMQX) is not yet deployed
The system SHALL, as configured today (`mosquitto/mosquitto.conf`, both `docker-compose.yml` and `docker-compose.staging.yml`), run `eclipse-mosquitto:2.0` with `allow_anonymous true` and no ACL — any network-reachable client can publish/subscribe to any tenant's telemetry topic. Two design docs (`docs/superpowers/specs/2026-07-09-mqtt-device-identity-design.md`, approved 2026-07-09, and its companion implementation plan `docs/superpowers/plans/2026-07-09-mqtt-device-identity.md`) specify replacing Mosquitto with `emqx/emqx:5.8` using PostgreSQL-backed authn/authz views (`mqtt_auth`, `mqtt_acl`) and a new `credential_type = 'mqtt_password'` row per device — **none of this is implemented yet**: no `emqx` service exists in any compose file, no `023_mqtt_auth` Alembic migration exists in `api/`, and Mosquitto is still the running broker.

#### Scenario: Someone reads the design doc and assumes it reflects production
- **WHEN** cross-referencing the design doc's decision record against `mosquitto/mosquitto.conf` and `docker-compose.staging.yml`
- **THEN** the doc itself states the current state accurately ("runs with `allow_anonymous true`... anyone with network access... can inject or spoof telemetry for any device in any tenant") — it is a forward-looking design, not a description of a completed migration; the gap is between this doc and the *implementation*, which has not started (Task 1 of the plan is unchecked)
