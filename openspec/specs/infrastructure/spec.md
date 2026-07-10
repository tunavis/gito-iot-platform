## Purpose
Describes the deployment topology as actually configured in `docker-compose.yml` (dev), `docker-compose.dev.yml` (dev override), `docker-compose.staging.yml` (staging), `nginx/nginx.conf`, and `mosquitto/mosquitto.conf`. Covers real services, networking, and the gap between the `grafana/` provisioning config in the repo and what's actually wired into any compose file.

## Requirements

### Requirement: A single nginx reverse proxy fronts both the API and the web app on one host/port
The system SHALL run nginx (`nginx:1.27-alpine`) listening on host `80`/`443`, routing by path prefix with longest-prefix-wins semantics: `/api/v1/ws/` (WebSocket upgrade headers, `proxy_read_timeout 3600s`) and `/api/` (general REST, `proxy_buffering off`) both go to the `api` upstream (FastAPI, container port 8000); everything else (`/`) goes to the `web` upstream (Next.js, container port 3000).

#### Scenario: A WebSocket connection request
- **WHEN** a client requests `/api/v1/ws/tenants/{id}/telemetry`
- **THEN** nginx matches the `/api/v1/ws/` location block (checked before the shorter `/api/` prefix) and sets `Upgrade`/`Connection: upgrade` headers with a 1-hour read/send timeout instead of the default

#### Scenario: A page request
- **WHEN** a browser requests `/dashboard`
- **THEN** nginx forwards to the `web` (Next.js) upstream with a 120s read timeout (long enough for Next.js dev-mode on-demand compilation)

### Requirement: No TLS termination is configured despite ports 443 being mapped
The system SHALL expose port 443 in every compose file's nginx service, but `nginx/nginx.conf` contains only a single `listen 80` server block with no `listen 443 ssl` directive, no `ssl_certificate` directive, and no active `server` block reading from `nginx/conf.d/` or `nginx/ssl/` — both of those directories are empty. TLS, if present at all in staging, is therefore terminated somewhere other than this nginx config (or not terminated).

#### Scenario: A client connects on port 443
- **WHEN** a request arrives on the mapped 443 port
- **THEN** nginx has no listener configured for it in `nginx.conf` — the port mapping exists in compose but is not backed by an active HTTPS server block

### Requirement: The platform MQTT broker is Eclipse Mosquitto with anonymous access enabled, in both dev and staging
The system SHALL run `eclipse-mosquitto:2.0` (not EMQX) in both `docker-compose.yml` and `docker-compose.staging.yml`, configured via the single shared `mosquitto/mosquitto.conf`, which sets `allow_anonymous true` and has no password file or ACL — any network-reachable client can publish or subscribe to any topic.

#### Scenario: A client connects to the broker without credentials
- **WHEN** any TCP client connects to port 1883 and publishes to an arbitrary `{tenant}/devices/{device}/telemetry` topic
- **THEN** Mosquitto accepts the connection and the publish (`allow_anonymous true`), and the processor trusts the topic string's `tenant_id`/`device_id` (checking only that the device row exists, not that the publisher is that device)

### Requirement: Grafana provisioning config exists in the repo but is not deployed by any compose file
The system SHALL ship `grafana/provisioning/{datasources,dashboards}/` (Prometheus, Loki, and PostgreSQL datasource definitions, plus a `platform-overview.json` dashboard) in the repository, but none of `docker-compose.yml`, `docker-compose.dev.yml`, or `docker-compose.staging.yml` define a `grafana`, `prometheus`, or `loki` service — none of those three names appears anywhere in the three compose files.

#### Scenario: `docker compose up` is run from any of the three compose files
- **WHEN** the dev or staging stack is brought up as documented (`deploy-staging.ps1`, `docker-compose.dev.yml` override)
- **THEN** no Grafana, Prometheus, or Loki container starts — the provisioning config is inert unless Grafana is run out-of-band against these same files

### Requirement: Dev and staging use different host port mappings and isolated Docker networks
The system SHALL bind dev-stack ports as `postgres:5433→5432`, `keydb:6379→6379`, `mosquitto:1883/8883`, `api:8001→8000`, `web:3001→3000`, `nginx:80/443`, all on network `gito-network`; the staging stack instead exposes only `nginx:80/443` externally plus `postgres:5433→5432` and `redis:6380→6379` for operator access, with `api`/`web`/`mosquitto`/`processor` reachable only inside `gito-staging-network` (no host port mappings) — staging additionally runs a `mqtt-bridge` testing UI on host port `5555`.

#### Scenario: An operator tries to curl the staging API container directly from the host
- **WHEN** they attempt `curl localhost:8000` on the staging host
- **THEN** it fails — staging's `api` service has no `ports:` mapping; the only path in is through nginx on 80/443

#### Scenario: Dev and staging Postgres versions diverge
- **WHEN** comparing images
- **THEN** dev runs `timescale/timescaledb:latest-pg16` while staging runs `timescale/timescaledb:latest-pg15` — different major Postgres versions between environments
