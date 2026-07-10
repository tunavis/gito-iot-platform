## Purpose
Lets a tenant connect external LoRaWAN network servers (webhook or MQTT bridge) as
authenticated ingest sources, and lets the platform send RPC commands to devices
over whichever protocol each device actually uses. Backed by
`api/app/routers/integrations.py`, `commands.py`, `api/app/models/base.py::Integration`,
`DeviceCommand`, and `api/app/services/command_dispatch.py`, `ota_dispatch.py`.

## Requirements

### Requirement: Integration bearer keys are shown once and stored only as a SHA-256 hash; webhook and MQTT-bridge integrations are two structurally different creation paths
The system SHALL, for webhook-style providers (`chirpstack|ttn|helium|actility|custom`),
generate a `gito_ik_`-prefixed random key (`secrets.token_urlsafe(32)`), store only
`sha256(key)` in `key_hash` plus a `key_prefix` (first 12 chars, for display/audit),
and return the plaintext key exactly once in `IntegrationCreatedResponse.key`. For
`chirpstack_mqtt`, no bearer key is issued at all (`key_hash`/`key_prefix` both
NULL, made nullable specifically for this provider by migration `017_chirpstack_mqtt`) —
instead `config` holds broker connection details (`MqttConfigValidator`, requiring
`broker_url`) and a "created" event is published to Redis channel
`integration:changes` so the processor's `ChirpStackBridgeManager` can pick it up
and connect out to the customer's broker.

#### Scenario: Creating a webhook integration
- **WHEN** `POST /tenants/{id}/integrations` is called with `provider=ttn`
- **THEN** `201` with the plaintext key returned once; a subsequent `GET` on that
  integration never exposes the key again — only `key_prefix` for display

#### Scenario: Creating an MQTT bridge integration
- **WHEN** `POST /tenants/{id}/integrations` is called with `provider=chirpstack_mqtt`
  and `config.broker_url` set
- **THEN** `201` with broker connection info in the response
  (`MqttIntegrationCreatedResponse`), `bridge_status: "pending"`, and no key
  material at all; `password`/`ca_cert` in the stored `config` are masked
  (`••••••••` / `"(set)"`) whenever the integration is read back via GET/list

#### Scenario: Rate limiting webhook ingest per integration
- **WHEN** an integration's key is used to ingest LoRaWAN uplinks
- **THEN** each request increments a Redis counter
  `rate:integration:{id}:{unix_minute}` (60s TTL set on first increment) and is
  rejected with `429 Too Many Requests` once the count exceeds `config.rate_limit`
  (default 600/minute) — the limit is configurable per-integration via its `config`
  JSONB

### Requirement: chirpstack_mqtt bridge status and unknown-device discovery are read live from Redis, not persisted
The system SHALL track live bridge connection status
(`bridge:status:{integration_id}` Redis key, written by the processor's bridge
worker, defaulting to `"pending"` when absent/Redis unreachable) and
bridge-discovered-but-unregistered dev_euis
(`bridge:unknown:{integration_id}` Redis hash, `dev_eui → first_seen_timestamp`)
entirely in Redis — neither is a database table. `GET /integrations` batch-fetches
both via `MGET`/per-integration `HKEYS` for every `chirpstack_mqtt` integration in
the list, and self-heals by excluding (and `HDEL`-ing) any dev_euis that have since
been registered as real devices, so the "unknown" badge count doesn't include
already-onboarded devices.

#### Scenario: Redis is down when listing integrations
- **WHEN** `GET /integrations` is called and Redis is unreachable
- **THEN** the list still returns (`200`) with `bridge_status` omitted/defaulted and
  `unknown_device_count: 0` for MQTT-bridge integrations — Redis unavailability
  degrades a display feature, it does not fail the endpoint

### Requirement: Device commands are a request-response lifecycle with a server-side TTL, dispatched synchronously at creation time
The system SHALL, on `POST /tenants/{id}/devices/{did}/commands`: check the
device's type `capabilities` list contains `"commands"` if a device type is
assigned (skipped entirely if no device type); create a `DeviceCommand` row
(`status='pending'`, `expires_at = now() + ttl_seconds`); then dispatch
synchronously via `CommandDispatchService.dispatch()` (same MQTT/HTTP/LoRaWAN
protocol-detection as OTA dispatch, reusing `ota_dispatch._detect_protocol`) before
returning the HTTP response — the command's `status` becomes `sent` on dispatch
success or `failed` (with `completed_at` stamped) on dispatch failure, all within
the same request/response cycle.

#### Scenario: Device type doesn't support commands
- **WHEN** the device has a `device_type_id` whose `capabilities` list exists and
  does not contain `"commands"`
- **THEN** `400 Bad Request` — "Device type does not support commands" (before any
  `DeviceCommand` row is created)

#### Scenario: Dispatch succeeds but device never actually executes
- **WHEN** `_dispatch_mqtt()` successfully publishes to the Redis command channel
- **THEN** the command's status becomes `sent` — "sent" only means the message
  reached the outbound channel (Redis pub/sub for MQTT, a ChirpStack downlink queue
  for LoRaWAN, an HTTP 2xx for webhook), not that the device received or acted on
  it; further lifecycle states (`delivered`, `executed`, `timed_out`) depend on the
  device responding via telemetry with reserved keys (`command_id`,
  `command_status`, `command_result`, `command_error`) and a background job
  (`expire_timed_out_commands`, scheduled every 30s in
  `background_tasks.py`) flipping stale `pending`/`sent` commands past their
  `expires_at` to `timed_out`

#### Scenario: Command dispatch protocol has no configuration for this device
- **WHEN** `_detect_protocol()` resolves to `lorawan` or `http` but the device
  lacks the ChirpStack URL/API key or `webhook_url` needed to actually reach it
- **THEN** `dispatch()` returns `(False, "<reason>")`, the command row is marked
  `failed` with `error_message` set, and the HTTP response still returns `201`
  (command was created — its failure is reflected in the returned `status` field,
  not the HTTP status code)
