## Purpose
Aggregates fleet health, alarm trends, and device uptime into dashboard-ready
statistics, computed on-the-fly from `devices`/`alarms`/`telemetry` rather than
stored as precomputed metrics. Backed by `api/app/routers/analytics.py`.

## Requirements

### Requirement: Effective device status recomputes offline state per-type, duplicating the same logic implemented in device-management
The system SHALL, in `get_fleet_overview` and `get_device_uptime`, independently
re-derive "effectively offline" (a device whose persisted `status='online'` but
`last_seen` is older than its type's `default_settings->>'offline_threshold'`, or a
900-second default `OFFLINE_THRESHOLD_SECONDS`) — once via a raw SQL `CASE`
expression (`fleet-overview`) and once via a Python helper `_is_effectively_online()`
(`device-uptime`). This is the same rule the `devices.py` router computes a third
time (via `DeviceResponse`'s model validator) for individual device reads — three
independent implementations of one business rule, with no shared function.

#### Scenario: A device with a never-set last_seen is trusted as online
- **WHEN** `_is_effectively_online()` evaluates a device with `status='online'` and
  `last_seen IS NULL`
- **THEN** it returns `True` ("never reported; trust provisioned status") — a
  freshly-provisioned device that has literally never sent telemetry counts as
  online/uptime-contributing until it either reports or its status is changed by
  something else

### Requirement: Fleet overview, alert trends, and device uptime are all live aggregate queries scoped by tenant_id and a rolling time window
The system SHALL compute `GET /analytics/fleet-overview` (status/type distribution,
average battery, low-battery count) with no time window (current snapshot only);
`GET /analytics/alert-trends?days=N` (1-90, default 30) and
`GET /analytics/device-uptime?days=N` (1-30, default 7) both compute against a
`fired_at`/`last_seen >= now() - N days` cutoff. None of these results are cached —
every call re-scans the relevant tables for the tenant.

#### Scenario: Alert trends for a tenant with zero alarms
- **WHEN** `GET /analytics/alert-trends` is called for a tenant with no `alarms`
  rows in the window
- **THEN** `200` with `total_alarms: 0` and empty distributions/trend arrays — no
  404 or error for the "no data" case

### Requirement: Top-alerting-devices uses an outer join so alarms on now-deleted devices still surface
The system SHALL LEFT JOIN `Alarm` to `Device` (`isouter=True`) when computing
`top_alerting_devices`, falling back to the raw `device_id` string as the display
name when the device row no longer exists (e.g. hard-deleted while its alarm
history remains, since `alarms.device_id` is `ON DELETE CASCADE` — actually
deleting the device would cascade-delete its alarms too, so this fallback path
would only trigger if a device row is missing for another reason, e.g. cross-tenant
data inconsistency).
