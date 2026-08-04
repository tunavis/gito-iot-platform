## MODIFIED Requirements

### Requirement: Device commands are a request-response lifecycle with a server-side TTL, dispatched synchronously at creation time
The system SHALL, on `POST /tenants/{id}/devices/{did}/commands`: reject the
caller with `403 Forbidden` unless their role is `SUPER_ADMIN`, `TENANT_ADMIN` or
`SITE_ADMIN`; check the device's type `capabilities` list contains `"commands"` if
a device type is assigned (skipped entirely if no device type); create a
`DeviceCommand` row (`status='pending'`, `expires_at = now() + ttl_seconds`); then
dispatch synchronously via `CommandDispatchService.dispatch()` (same
MQTT/HTTP/LoRaWAN protocol-detection as OTA dispatch, reusing
`ota_dispatch._detect_protocol`) before returning the HTTP response — the
command's `status` becomes `sent` on dispatch success or `failed` (with
`completed_at` stamped) on dispatch failure, all within the same request/response
cycle.

The role restriction is new and is a breaking change: this endpoint previously
accepted any authenticated tenant user. It exists because the approval gate on
the agent path is otherwise walkable — anyone refused at approve could issue the
identical command here — and because MCP already enforces this same ladder for
the same action, so the two rules disagreed.

#### Scenario: A read-only role attempts to issue a command
- **WHEN** a `VIEWER` or `CLIENT` calls `POST /tenants/{id}/devices/{did}/commands`
- **THEN** `403 Forbidden` before any `DeviceCommand` row is created

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

## ADDED Requirements

### Requirement: `rejected` is a terminal command status distinct from lapsing
The `device_commands.status` CHECK SHALL include `rejected`, alongside the
`awaiting_approval` value added for the approval gate. A rejected command SHALL
never be dispatched, and SHALL be distinguishable from one that merely expired.

Adding it as a `status` value rather than a parallel column keeps every existing
reader blind to it by construction — including `expire_timed_out_commands`, which
sweeps only `('pending','sent','delivered')`.

#### Scenario: A rejected command is swept
- **WHEN** the timeout sweep runs and a `rejected` command's `expires_at` has passed
- **THEN** the sweep does not touch it — it is already terminal, and rewriting it
  to `timed_out` would erase the fact that a person refused it

#### Scenario: The status set is rolled back
- **WHEN** migration `028` is downgraded
- **THEN** any `rejected` row becomes `failed` with its `error_message`
  preserved, rather than being deleted — the refusal happened
