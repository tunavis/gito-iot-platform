## Purpose
CRUD and lifecycle for IoT devices, the device-type templates that define their
telemetry schema/capabilities, and logical device groups used for bulk operations.
Backed by `api/app/routers/devices.py`, `device_types.py`, `device_groups.py`,
`api/app/models/base.py::Device`, `api/app/models/device_type.py`,
`api/app/models/device_group.py`, and `api/app/services/device_management.py`.

## Requirements

### Requirement: dev_EUI is unique per tenant, checked explicitly before insert
The system SHALL, on `POST /tenants/{id}/devices`, pre-check whether `dev_eui` is
already registered to another device in the same tenant and return a descriptive
`409` instead of letting the DB's unique index (`idx_devices_tenant_dev_eui` on
`(tenant_id, dev_eui)`) raise a raw `IntegrityError`.

#### Scenario: Duplicate dev_EUI in same tenant
- **WHEN** `POST /devices` supplies a `dev_eui` already owned by another device in
  the tenant
- **THEN** `409 Conflict` — "dev_EUI '<eui>' is already registered to device '<name>'."

#### Scenario: Same dev_EUI across two different tenants
- **WHEN** two different tenants each register a device with the same `dev_eui`
- **THEN** both succeed — the unique index is scoped to `(tenant_id, dev_eui)`, not
  global

### Requirement: GPS and vendor fields are merged into the `attributes` JSONB, not dedicated columns
The system SHALL fold `latitude`, `longitude`, `serial_number` (duplicated into both
the column and `attributes`), `mqtt_client_id`, and `app_key` from `DeviceCreate`
into the `devices.attributes` JSONB blob rather than first-class columns (except
`serial_number`, which is also a real column).

#### Scenario: Creating a device with GPS coordinates
- **WHEN** `POST /devices` supplies `latitude`/`longitude`
- **THEN** the stored `attributes` JSONB contains `{"latitude": ..., "longitude": ...}`
  alongside any other attribute fields; there are no `latitude`/`longitude` columns
  on `devices`

### Requirement: Setting dev_eui/ttn_app_id/device_profile_id triggers async ChirpStack/TTN sync, best-effort
The system SHALL, after `POST` or `PUT /devices/{id}` when LoRaWAN fields
(`dev_eui`, `ttn_app_id`, `device_profile_id`) are present/changed, call
`DeviceManagementService.sync_to_chirpstack()`. A failure there is caught, logged
as `chirpstack_sync_failed_on_create`/`_on_update`, and does **not** fail the HTTP
request — the device row is still created/updated even if the ChirpStack sync fails.

#### Scenario: ChirpStack unreachable during device creation
- **WHEN** `POST /devices` includes a `dev_eui` and the ChirpStack API call inside
  `sync_to_chirpstack` raises
- **THEN** the device is still created and `201` is returned; the sync failure is
  only visible in server logs, not in the API response — the client has no signal
  that ChirpStack provisioning didn't happen

### Requirement: Device delete cascades to ChirpStack cleanup only if previously synced
The system SHALL, on `DELETE /devices/{id}`, call `delete_from_chirpstack()` only
when `device.ttn_synced` is true, and proceed to delete the local row regardless of
whether that remote cleanup succeeds.

### Requirement: Bulk device registration deduplicates within the tenant and validates dev_EUI format
The system SHALL, on `POST /tenants/{id}/devices/bulk-register`, normalize each
submitted `dev_euis` entry to lowercase and require it to match `[0-9a-f]{16}`;
entries failing the pattern are reported in `invalid` and skipped. Euis already
registered **in this tenant** are reported in `skipped_already_registered` and
skipped (cross-tenant duplicates are allowed, per the per-tenant unique index).
Successfully created devices are named `"{prefix} {last-4-hex-uppercased}"` where
`prefix` is `name_prefix` or the device type's name.

#### Scenario: Mixed valid/invalid/duplicate input
- **WHEN** `bulk-register` is called with 10 euis: 2 malformed, 3 already
  registered in this tenant, 5 new
- **THEN** 5 devices are created, `invalid` lists the 2 malformed strings verbatim,
  `skipped_already_registered` lists the 3 duplicates, and (if `integration_id` was
  supplied) the 5 newly-registered euis are removed from that integration's Redis
  "unknown devices" hash (`bridge:unknown:{integration_id}`)

### Requirement: Device offline status is computed per-request from a per-type threshold, not stored
The system SHALL treat a device's persisted `status='online'` as potentially stale:
`devices.py::_fetch_offline_thresholds` batch-reads
`device_types.default_settings->>'offline_threshold'` (seconds) for the listed
devices, and the response schema (`DeviceResponse`, via a model validator not shown
in the router but referenced by `_to_response`) recomputes effective status using
`last_seen` vs. that threshold — falling back to a 900-second (15 minute) default
when no per-type threshold is configured (the same `OFFLINE_THRESHOLD_SECONDS = 900`
constant is duplicated in `analytics.py`).

#### Scenario: Device stopped reporting but DB status still says online
- **WHEN** a device's `last_seen` is older than its type's `offline_threshold` (or
  900s default) but `devices.status` column still reads `'online'` (no background
  job has flipped it yet for this particular read)
- **THEN** `GET /devices` and `GET /devices/{id}` responses report it as effectively
  offline via `offline_threshold`-aware computation, while `GET /analytics/fleet-overview`
  independently recomputes the same effective-status logic in raw SQL — two separate
  implementations of the same rule that must be kept in sync by hand

### Requirement: Device types define the telemetry schema, key mapping, decoder, and command schema
The system SHALL let `device_types.data_model` (JSONB array of `{name, type, unit,
description, min, max, required}`) describe expected telemetry fields;
`key_mapping` (JSONB) rewrite raw device payload keys to canonical metric keys at
ingest time; `decoder` (JSONB, added in migration `022_payload_decoding`) hold a
declarative byte-layout spec for LoRaWAN payloads the network server didn't decode;
`command_schema` (JSONB) describe supported RPC commands; `capabilities` (JSONB
array) gate whether a device type supports commands (checked as
`"commands" in capabilities`).

#### Scenario: Device type created with key_mapping/decoder/command_schema
- **WHEN** `POST /tenants/{id}/device-types` supplies all four fields
- **THEN** all four are persisted on create — the router comment explicitly notes
  this was previously a bug ("Previously dropped on create (only persisted via a
  later update) — fixed") — `api/app/routers/device_types.py:182-185`, implying an
  earlier version of this endpoint silently discarded `key_mapping`/`command_schema`/
  `decoder` on creation

#### Scenario: Delete a device type with assigned devices
- **WHEN** `DELETE /device-types/{id}` is called without `?force=true` and the live
  count of devices referencing it (`SELECT COUNT(*) FROM devices WHERE device_type_id = :id`,
  not the cached `device_types.device_count` column) is greater than zero
- **THEN** `400 Bad Request` — "Cannot delete device type with N assigned devices.
  Use force=true to delete anyway." With `force=true`, the type is deleted and
  `devices.device_type_id` is set NULL via the FK's `ON DELETE SET NULL`

#### Scenario: device_count column is a cache, not authoritative
- **WHEN** any device-type list/get/clone/delete endpoint runs
- **THEN** it overwrites `device_type.device_count` in-memory from a fresh
  `COUNT(*) FROM devices WHERE device_type_id = :id` query before serializing the
  response — the persisted `device_types.device_count` integer column is never
  trusted or even necessarily kept in sync by writes elsewhere

### Requirement: Discovered-metrics endpoint diffs live telemetry keys against the declared schema
The system SHALL, on `GET /device-types/{id}/discovered-metrics`, query distinct
`metric_key`s seen in `telemetry` for devices of this type within the last N days
(default 7, max 30) and flag each as `in_schema: true/false` against
`data_model[].name`, helping operators reconcile actual device output with the
declared schema.

### Requirement: Device groups require both organization_id and site_id (strict hierarchy)
The system SHALL make `organization_id` and `site_id` **required** (not optional) on
`DeviceGroupCreate` — unlike `Device` and `Site`, which allow a null
`organization_id`/`site_id`. A device group cannot exist outside the Org→Site
hierarchy.

#### Scenario: Create a device group without a site
- **WHEN** `POST /tenants/{id}/device-groups` omits `site_id`
- **THEN** request validation fails at the Pydantic layer (`422`) before any
  handler code runs, since `site_id: UUID` has no default
