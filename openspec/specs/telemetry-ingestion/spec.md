## Purpose
Gets telemetry from a device into TimescaleDB and out to dashboards/alarms in real
time, across four independent entry points (JWT REST, device-token REST, LoRaWAN
webhook, native MQTT), through a single Redis-Streams funnel consumed by the
standalone `processor` service so alarm evaluation is identical regardless of how
data arrived. Backed by `api/app/routers/telemetry.py`, `telemetry_aggregate.py`,
`device_ingest.py`, `lorawan_ingest.py`, `websocket.py`,
`api/app/services/telemetry_stream.py`, `digital_twin.py`, `lorawan_parsers.py`,
`processor/mqtt_processor.py`, and `shared/payload_codec`.

## Requirements

### Requirement: Telemetry is stored key-value, one row per metric per timestamp
The system SHALL store each metric as a separate row in the `telemetry` hypertable
(`tenant_id, device_id, metric_key, metric_value|metric_value_str|metric_value_json,
unit, ts`), typed by inspecting the incoming JSON value (`int`/`float` →
`metric_value`, `str` → `metric_value_str`, `dict`/`list` → `metric_value_json` as a
JSON string, anything else stringified). Queries pivot back to one JSON object per
timestamp using `jsonb_object_agg`.

#### Scenario: Mixed-type payload
- **WHEN** a payload is `{"temperature": 25.5, "status": "running", "gps": {"lat": 1, "lon": 2}}`
- **THEN** three `telemetry` rows are written at the same `ts`: one with
  `metric_value=25.5`, one with `metric_value_str='running'`, one with
  `metric_value_json='{"lat":1,"lon":2}'`

### Requirement: telemetry table has Row-Level Security permanently DISABLED
The system SHALL run with `ALTER TABLE telemetry DISABLE ROW LEVEL SECURITY`
(migration `010_timescaledb`, explicitly not re-enabled by any later migration) —
required because TimescaleDB compression and continuous aggregates
(`telemetry_hourly`, `telemetry_daily`) are incompatible with RLS. Tenant isolation
for telemetry reads/writes is therefore enforced **entirely by explicit
`WHERE tenant_id = :tenant_id` clauses in application code** — every telemetry
query in `telemetry.py`, `telemetry_aggregate.py`, `device_ingest.py`,
`lorawan_ingest.py`, and the processor must get this right by hand; there is no
database-level fallback if one is missed. This is a documented, deliberate
tradeoff (see migration docstring, citing ThingsBoard/Cumulocity precedent), not an
oversight — but it is a real deviation from the "RLS on every tenant-scoped table"
pattern the rest of the schema follows and that CLAUDE.md documents as the
required pattern.

#### Scenario: A telemetry query without a tenant filter
- **WHEN** hypothetically a new endpoint queried `telemetry` without a
  `tenant_id = :tenant_id` predicate
- **THEN** it would return rows across all tenants — RLS provides no safety net
  here, unlike every other tenant-scoped table in the schema

### Requirement: All four REST/MQTT ingest paths publish through the same funnel; none write Telemetry rows directly
The system SHALL have every ingest entry point — `telemetry.py::ingest_telemetry`
(JWT REST), `device_ingest.py` (token-based `/ingest`), and `lorawan_ingest.py`
(`/ingest/lorawan/{provider}`) — call `stream_ingest()` (`XADD telemetry:ingest`)
rather than writing `Telemetry` rows directly, so the processor's
`StreamConsumer._process_entries` (`processor/mqtt_processor.py:638-758`) is the
one place that performs the Timescale insert AND alarm evaluation, matching the
"single funnel" design documented in `api/app/services/telemetry_stream.py`'s
module docstring. Each REST endpoint additionally publishes directly to Redis
pub/sub (and updates the digital twin cache) for immediate WebSocket delivery —
that's just for UI responsiveness ahead of the processor's own consume cycle, not
a second storage/alarm path. If `request.app.state.redis` is unavailable, or the
`XADD` itself fails, the endpoint returns `503` so the caller retries instead of
silently losing the data (device tokens/scripts should retry on `503`).

#### Scenario: Threshold breach posted via the JWT telemetry endpoint
- **WHEN** a user (or a script holding a user JWT) calls
  `POST /tenants/{tid}/devices/{did}/telemetry` with a value that would trip an
  active THRESHOLD alert rule for that device/metric
- **THEN** `stream_ingest()` publishes it to `telemetry:ingest`, the processor
  consumes it, inserts the row, and evaluates the rule — an `alert_events`/`alarms`
  row is created exactly as it would be for the same value delivered via
  `/ingest` (device token) or `/ingest/lorawan/{provider}`

#### Scenario: Redis unavailable when the JWT endpoint is called
- **WHEN** `request.app.state.redis` is `None`, or `stream_ingest()` raises
- **THEN** the endpoint returns `503 Service Unavailable` without touching the
  database — no telemetry row is written and no partial/inconsistent state is left
  behind for the caller to retry against

### Requirement: Device-token and LoRaWAN ingest publish to a shared Redis Stream; the processor is the single insert+alarm point
The system SHALL have `device_ingest.py` and `lorawan_ingest.py` call
`stream_ingest(redis, tenant_id, device_id, metrics, ts)` which does
`XADD telemetry:ingest {tenant_id, device_id, payload, timestamp}` (maxlen ~100k,
approximate trim). The processor's `StreamConsumer.run()` reads via
`XREADGROUP GROUP telemetry-processors ... BLOCK 100ms`, batch-inserts into
`telemetry`, and (only for messages whose batch insert succeeded) invokes the
alarm-evaluation callback once per message, then `XACK`s. A 30-second periodic
`XAUTOCLAIM` reclaims entries left pending by a crashed consumer.

#### Scenario: Redis is unavailable at ingest time
- **WHEN** `request.app.state.redis` is `None` or `stream_ingest()` raises
- **THEN** `device_ingest.py`/`lorawan_ingest.py` return `503 Service Unavailable`
  — "Ingest pipeline unavailable — retry" — the device is expected to retry rather
  than silently lose the reading

#### Scenario: Batch insert fails for one tenant among a mixed batch
- **WHEN** `DatabaseService.batch_insert_telemetry()` reports a tenant's rows failed
  (e.g. transient DB error)
- **THEN** only that tenant's stream message IDs are withheld from `XACK` (left
  pending for `_reclaim_pending` to retry after `PENDING_CLAIM_MS`); other tenants'
  messages in the same batch are still acknowledged and their alarms still
  evaluated — a partial-batch failure does not block unrelated tenants

#### Scenario: Malformed stream entry
- **WHEN** a stream entry's `payload` isn't valid JSON or is missing
  `tenant_id`/`device_id`/`timestamp`
- **THEN** it is unconditionally `XACK`'d immediately (never retried — a malformed
  entry can never succeed on retry) and dropped with a warning log

#### Scenario: Alarm evaluation failure never blocks telemetry durability
- **WHEN** `self._evaluate_fn(tenant_id, device_id, payload, timestamp)` raises for
  one message in a batch
- **THEN** the exception is caught and logged per-message; the stream entry is
  still ACKed (telemetry was already durably inserted) — alarm evaluation is
  best-effort, telemetry persistence is not

### Requirement: Device-type key_mapping rewrites raw payload keys before storage, applied independently per ingest path
The system SHALL, in each of `telemetry.py`, `device_ingest.py`, and
`lorawan_ingest.py`, separately look up the device's `device_type.key_mapping`
JSONB and rewrite `{raw_key: value}` to `{key_mapping.get(raw_key, raw_key): value}`
before persisting — this lookup and rewrite logic is duplicated three times (three
near-identical SQL/ORM queries and dict comprehensions) rather than shared in one
function.

### Requirement: LoRaWAN ingest requires provider-specific parsing, a resolvable dev_eui, and never double-decodes
The system SHALL, on `POST /ingest/lorawan/{provider}`: resolve the bearer key via
`resolve_integration_key()` (SECURITY DEFINER, bypasses RLS); reject if the
integration is inactive or its stored `provider` doesn't match the path's
`{provider}`; rate-limit at `config.rate_limit` (default 600) messages/minute per
integration via a Redis `INCR` counter keyed by `rate:integration:{id}:{minute}`;
deduplicate via `SETNX dedup:lora:{uplink.dedup_id}` with a 30s TTL; look up the
device by `dev_eui` (404 if unregistered); and only attempt the device type's
declarative `decoder` spec (`payload_codec.decode`) when the network server did NOT
already provide decoded `object` fields (`uplink.metrics` empty) — never both.

#### Scenario: Unknown provider path segment
- **WHEN** `POST /ingest/lorawan/{provider}` is called with a `provider` not in
  `chirpstack|ttn|helium|actility|custom`
- **THEN** `400 Bad Request` listing supported providers (checked before auth)

#### Scenario: Integration key valid but registered for a different provider
- **WHEN** the resolved integration's `provider` column doesn't match the URL's
  `{provider}` segment
- **THEN** `403 Forbidden` — "Key is registered for provider '<x>', not '<url provider>'"

#### Scenario: Duplicate uplink within the dedup window
- **WHEN** the same `uplink.dedup_id` is seen again within 30 seconds (LNS retry/
  redelivery)
- **THEN** `201` is still returned but with `{"ingested": 0, "duplicate": true}` —
  no telemetry write, no raw_uplinks row, no device status update

#### Scenario: Network server decoded nothing and device type has no decoder
- **WHEN** `uplink.metrics` is empty and `device_type.decoder` is null
- **THEN** the raw payload is still persisted to `raw_uplinks` (decoded=false,
  codec_used=NULL) for later re-decode, the device's `last_seen`/`status='online'`
  are updated (it IS transmitting), but `{"ingested": 0, "decoded": false}` is
  returned and no telemetry rows or stream message are produced — this device
  will NOT be flagged offline even though it's producing zero usable metrics

#### Scenario: Device type has a declarative decoder and NS didn't decode
- **WHEN** `uplink.metrics` is empty and `device_type.decoder` is a valid
  declarative spec matching the uplink's `f_port`
- **THEN** `payload_codec.decode()` unpacks the base64 raw payload per the spec's
  `fields[]` (struct-based, `uint8|int8|uint16|int16|uint32|int32|float32`, offset/
  length/endian/scale/value_offset), the result becomes `metrics`, and
  `raw_uplinks.codec_used='declarative'`, `decoded=true`

#### Scenario: Raw uplink persistence failure is non-fatal
- **WHEN** the `INSERT INTO raw_uplinks` fails (e.g. transient DB error)
- **THEN** the exception is caught and logged as a warning; ingestion continues to
  the telemetry stream publish step regardless — raw-uplink archival is best-effort

### Requirement: LoRaWAN radio metadata is namespaced with a `__lora_` prefix and merged into the same metric set
The system SHALL map `uplink.radio` fields (`rssi`, `snr`, `gateway_id`, `frequency`,
`spreading_factor`, `frame_count`, `data_rate`) to `__lora_rssi`, `__lora_snr`, etc.
and merge them alongside decoded/NS metrics before applying `key_mapping` and
publishing to the stream — so radio quality metrics are stored as ordinary
`telemetry` rows with a reserved-prefix key, not a separate table.

### Requirement: Gateway fan-out ingest lets one authenticated gateway push metrics for multiple sub-devices
The system SHALL, on `POST /ingest/gateway`, authenticate the **gateway's own**
device token, then require each entry in `devices[]` to reference a
`device_id` whose `devices.gateway_id` FK points back to the authenticated gateway
— sub-devices not linked to this gateway are skipped with a per-entry error message,
not a hard failure of the whole request.

#### Scenario: Partial success across a batch of sub-devices
- **WHEN** a gateway fan-out request includes 5 sub-device entries, 2 of which are
  not linked to this gateway
- **THEN** the 3 valid entries are ingested (each individually stream-published),
  the response reports `devices: 3`, and `warnings` lists the 2 skipped entries by
  device_id and reason; the request still returns `201` unless **zero** metrics were
  ingested (in which case `400`)

### Requirement: Digital twin cache and WebSocket delivery are best-effort, non-blocking side effects of ingest
The system SHALL, after each successful ingest (device-token and LoRaWAN paths;
the direct-DB `telemetry.py` POST path does this too), attempt to `redis.publish("telemetry:{tenant}:{device}", ...)` and update a KeyDB-backed digital twin hash via
`DigitalTwinService`; failures in either are caught and logged as warnings without
affecting the HTTP response, since the telemetry write itself already succeeded.

#### Scenario: Read the digital twin cache directly
- **WHEN** `GET /tenants/{tid}/devices/{did}/telemetry/cached` is called
- **THEN** it returns the last-known value per metric from the KeyDB hash with
  `cached: true`, or `{"metrics": {}, "cached": false}` if Redis is unavailable or
  no cache entry exists yet — this path never touches Postgres for the metric
  values themselves (only to verify the device exists)

### Requirement: Telemetry queries support raw and time-bucketed aggregation with an auto-selected bucket size
The system SHALL, on `GET /tenants/{tid}/devices/{did}/telemetry`, require
`start_time` and validate `start_time < end_time`; support `aggregation=raw|avg|min|max|sum`;
for non-raw aggregation, auto-select `DATE_TRUNC` granularity from query duration
(≤1h → minute, ≤24h → hour, ≤168h → hour, else → day) via
`TelemetryAggregator.get_time_bucket_size`.

#### Scenario: start_time after end_time
- **WHEN** `start_time >= end_time`
- **THEN** `400 Bad Request` — "start_time must be before end_time"

#### Scenario: Tenant-level hourly aggregate uses continuous aggregates with a raw-data fill for the refresh lag
- **WHEN** `GET /tenants/{tid}/telemetry/hourly?metric=temperature&hours=24` is called
- **THEN** buckets older than 1 hour are read from the pre-computed
  `telemetry_hourly` continuous aggregate (fast); the most recent 2 hours are
  computed from raw `telemetry` rows to cover the aggregate's refresh lag (it
  auto-refreshes every 30 minutes per migration `010_timescaledb`); the two result
  sets are merged by hour-of-day label, with raw values overriding aggregate values
  for overlapping buckets

#### Scenario: metric=messages requests a raw count, never the continuous aggregate
- **WHEN** `?metric=messages` is passed to the hourly aggregate endpoint
- **THEN** it always queries raw `telemetry` with `COUNT(*)` — message counts are
  not part of the `telemetry_hourly`/`telemetry_daily` materialized views

### Requirement: WebSocket delivery is per-device-channel Redis pub/sub, tenant-isolated by channel naming rather than device-ownership check
The system SHALL, on `GET /ws/devices/{device_id}?token=<jwt>`, decode the JWT to
get `(tenant_id, user_id)`, then subscribe to `telemetry:{tenant_id}:{device_id}` and
`alerts:{tenant_id}:{device_id}` on Redis pub/sub. It does **not** query the database
to confirm `device_id` actually belongs to `tenant_id` — isolation instead relies on
publishers always constructing the channel name from the device's real
`tenant_id`, so a JWT for tenant A subscribing to a device_id from tenant B would
listen on a channel `telemetry:{A}:{B's device}` that no publisher ever writes to.

#### Scenario: Missing or invalid token
- **WHEN** `token` query param is absent or fails `decode_token`
- **THEN** the WebSocket is closed with code `1008` (policy violation) before
  `accept()` is called
