## Purpose
Manages firmware binaries, groups devices into OTA campaigns, and dispatches update
commands to devices over whichever protocol each device actually uses. Backed by
`api/app/routers/firmware.py`, `api/app/models/base.py` (`FirmwareVersion`,
`OTACampaign`, `OTACampaignDevice`, `DeviceFirmwareHistory`), and
`api/app/services/ota_dispatch.py`.

## Requirements

### Requirement: Firmware version is immutable metadata; url/hash/size are supplied by the caller, not computed server-side
The system SHALL, on `POST /tenants/{id}/firmware/versions`, persist whatever
`url`, `size_bytes`, and `hash` (SHA-256) the caller supplies — there is no upload
endpoint that receives a binary and computes these itself; the caller is expected to
have already placed the binary at `url` (e.g. S3/CDN) and computed its hash.
`(tenant_id, version)` is unique (`unique_version_per_tenant`).

#### Scenario: Duplicate version string for the same tenant
- **WHEN** `POST /firmware/versions` is called twice with the same `version` string
  for the same tenant
- **THEN** the second call fails on the DB unique constraint (no explicit
  pre-check/409 handling in this router, unlike the dev_eui/email/slug duplicate
  checks elsewhere — a raw IntegrityError propagates as a 500 rather than a clean
  4xx)

### Requirement: Campaigns can only be edited or deleted while in `draft` status
The system SHALL reject `PUT`/`DELETE /ota/campaigns/{id}` with `409 Conflict` once
a campaign has left `draft` (i.e. after `execute` has run) — "Only draft campaigns
can be updated"/"...deleted".

#### Scenario: Editing a running campaign
- **WHEN** `PUT /ota/campaigns/{id}` targets a campaign with `status='in_progress'`
- **THEN** `409 Conflict` — "Only draft campaigns can be updated"

### Requirement: Executing a campaign dispatches synchronously, per-device, via protocol auto-detection — there is no Cadence/workflow-engine integration
The system SHALL, on `POST /ota/campaigns/{id}/execute`: resolve target devices
(explicit `device_ids` in the request, or all tenant devices if omitted); create one
`OTACampaignDevice` row per target; flip the campaign to `in_progress`; then loop
over devices calling `OTADispatchService.dispatch()` synchronously in the request
handler (not a background job/workflow), setting each `OTACampaignDevice.status`
to `in_progress` (dispatch succeeded, awaiting device to actually apply it and
report back — see the progress_percent requirement below) or `failed` (with
`error_message` and `completed_at`) based on that call's outcome.
`OTADispatchService._detect_protocol()` picks `lorawan` (device has `dev_eui` and
`ttn_synced`), `http` (device `attributes.webhook_url`/`callback_url` set), or
defaults to `mqtt` (publishes the OTA command as JSON to Redis/KeyDB channel
`{tenant_id}/devices/{device_id}/commands`, which the MQTT processor is expected
to bridge onto the broker). `OTACampaign`'s sibling `group_bulk_operations`/
`GroupDeviceGroup` schema has a `cadence_workflow_id` field, but no Cadence
SDK/client exists anywhere in the codebase (`requirements.txt`/`pyproject.toml`
have no Cadence dependency) — nothing here actually uses it.

#### Scenario: Dispatch succeeds for some devices, fails for others
- **WHEN** `OTADispatchService.dispatch()` returns `(True, None)` for one device
  and `(False, "device unreachable")` for another
- **THEN** the first device's `OTACampaignDevice.status` becomes `in_progress`
  with `started_at` set; the second becomes `failed` with `error_message` set
  and `completed_at` set — previously the failure branch queried the row and
  discarded the result without ever mutating or committing it, so every row
  stayed `pending` regardless of what actually happened

#### Scenario: No devices to target
- **WHEN** `execute` is called with an empty explicit `device_ids` list and the
  tenant has zero devices (or all specified IDs don't resolve)
- **THEN** `400 Bad Request` — "No devices to update"

#### Scenario: Per-device dispatch failure doesn't abort the campaign
- **WHEN** one device's dispatch raises (e.g. ChirpStack unreachable, no
  `webhook_url` configured for an `http`-protocol device)
- **THEN** that device is counted in `failed`, its error captured in the response's
  `errors[]`, and the loop continues to the next device — the campaign is not
  rolled back and remains `in_progress`

#### Scenario: A device with no dev_eui/ttn_synced/webhook_url defaults to MQTT
- **WHEN** `_detect_protocol()` finds no explicit `attributes.protocol` override, no
  LoRaWAN sync, and no webhook URL
- **THEN** it defaults to `mqtt` — publishing to the Redis command channel succeeds
  as long as Redis is reachable, **regardless of whether the device is actually
  listening on MQTT at all** (dispatch "success" here means the message was
  published, not that the device received or acted on it)

### Requirement: Campaign progress is derived from OTACampaignDevice status counts, computed on read, not stored
The system SHALL, on `GET /ota/campaigns/{id}/status`, compute `progress_percent`
as `completed / total * 100` (rounded) from a live count of `OTACampaignDevice`
rows grouped by `status`, rather than reading a persisted progress field. Devices
report their own OTA progress back via reserved telemetry keys
(`ota_status`/`ota_progress`/`ota_error`, per `ota_dispatch.py`'s module docstring);
`processor/mqtt_processor.py::MQTTProcessor._handle_ota_progress()` consumes them
— called from both native-MQTT (`process_telemetry`) and ChirpStack-native
(`_process_chirpstack_uplink`) ingest paths, the same two places
`_handle_command_response` (the analogous command-response correlation) is called
from, and NOT from the generic REST/stream-funnel path (`_process_entries`) —
matching that existing precedent rather than introducing a new convention.
`ota_status` values map onto `OTACampaignDevice.status`'s narrower CHECK
constraint (`pending`/`in_progress`/`completed`/`failed`/`skipped`):
`downloading`/`installing` both collapse to `in_progress`. The row updated is
the device's most recent `pending`/`in_progress` `OTACampaignDevice`, matched
by joining through `ota_campaigns` for the tenant boundary (`ota_campaign_devices`
has no `tenant_id` column of its own, and no RLS policy — this join is the
actual scoping, not defense in depth).

#### Scenario: Device reports OTA progress via telemetry
- **WHEN** a device publishes telemetry containing `ota_status: "downloading"`,
  `ota_progress: 42`
- **THEN** its active `OTACampaignDevice` row gets `status = 'in_progress'`,
  `progress_percent = 42`, and `GET /ota/campaigns/{id}/status`'s computed
  percentage reflects it on the next read

#### Scenario: Device reports OTA failure
- **WHEN** telemetry contains `ota_status: "failed"`, `ota_error: "flash write failed"`
- **THEN** the row gets `status = 'failed'`, `error_message` set, and
  `completed_at = now()`
