## Purpose
Defines alert rules (threshold and composite), evaluates them against ingested
telemetry, tracks the resulting alarm lifecycle (ACTIVE → ACKNOWLEDGED → CLEARED),
and routes notifications to channels. Backed by `api/app/routers/alarms.py`,
`alert_rules_unified.py`, `notification_rules.py`, `notifications.py`,
`api/app/models/alarm.py`, `unified_alert_rule.py`, `notification.py`,
`api/app/services/notification_dispatcher.py`, `background_tasks.py`,
`shared/alarm_core`, and the evaluation call site in `processor/mqtt_processor.py`.

## Requirements

### Requirement: Alert rule evaluation logic is a single shared, pure library used by both the processor and the preview endpoint
The system SHALL implement THRESHOLD and COMPOSITE rule evaluation once, in
`shared/alarm_core/alarm_core/engine.py::evaluate()`, imported by both
`processor/mqtt_processor.py` (live evaluation on every stream-consumed message) and
`api/app/routers/alert_rules_unified.py::preview_alert_rule` (replay against
historical telemetry) — so "would this rule have fired" previews match production
behavior exactly. `evaluate()` is pure (no I/O, no clock reads) and a malformed rule
(unknown operator/logic, non-numeric value) is skipped without raising or blocking
other rules in the same batch.

#### Scenario: Cooldown suppresses re-firing
- **WHEN** `now < rule.last_fired_at + cooldown_minutes`
- **THEN** the rule is skipped for this evaluation, even if its condition is met
  (boundary case: firing is allowed exactly AT `last_fired_at + cooldown_minutes`,
  not strictly after)

#### Scenario: COMPOSITE rule with AND logic, one condition unmet
- **WHEN** a COMPOSITE rule has `logic='AND'` and 3 conditions, 2 met
- **THEN** it does not fire (`all(met_flags)` is false); the weighted `score_percent`
  computed from `weight`s is only surfaced when the rule DOES fire

#### Scenario: Non-numeric telemetry value against a numeric threshold
- **WHEN** a condition's field value in the payload is a non-numeric string (e.g.
  `"N/A"`)
- **THEN** `_coerce()` returns `None` and `_condition_met()` returns `False` — the
  condition is treated as not-met, not as an error

### Requirement: rule_type/severity format normalization is centralized in the model, not hand-rolled per call site
`UnifiedAlertRule.@validates('rule_type')`/`@validates('severity')`
(`api/app/models/unified_alert_rule.py`) convert API-facing values
(`"THRESHOLD"`/`"COMPOSITE"`, `"info"`/`"warning"`/`"critical"`) to DB-stored
values (`"SIMPLE"`/`"COMPLEX"`, `"MINOR"`/`"WARNING"`/`"CRITICAL"`) whenever the
field is **assigned** in Python — but this does not run when SQLAlchemy loads a
row from the database, and some rows predate these hooks (or were written via
raw SQL) and store the API-format string directly. The system SHALL therefore
never compare a `rule_type`/`severity` value of unknown provenance against a
single literal — `normalize_rule_type()` and the `RULE_TYPE_DB_VALUES`/
`SEVERITY_DB_VALUES` dicts (same module) are the one place this normalization
happens, used by:
- `list_alert_rules`'s `rule_type`/`severity` query filters
  (`UnifiedAlertRule.rule_type.in_(RULE_TYPE_DB_VALUES[...])`, and the
  equivalent for severity) — matches every stored variant of the requested
  type instead of one literal
- `update_alert_rule` (PUT) — gates the THRESHOLD-only
  (`metric`/`operator`/`threshold`) and COMPOSITE-only (`conditions`/`logic`)
  update branches on `normalize_rule_type(rule.rule_type)`
- `preview_alert_rule` — calls `normalize_rule_type(rule.rule_type)` instead of
  its own inline copy of the same check

The processor (`processor/mqtt_processor.py::_rule_type()`) independently
implements the same normalization for the same reason (DB stores legacy names,
`alarm_core` speaks THRESHOLD/COMPOSITE) — it's a separate service with its own
dependency tree, so this one is intentionally still a duplicate rather than a
cross-service import.

#### Scenario: Filtering the rule list by type
- **WHEN** `GET /tenants/{id}/alert-rules?rule_type=THRESHOLD` is called against a
  tenant that has THRESHOLD rules (stored as `"SIMPLE"`, or `"THRESHOLD"` for any
  legacy row written before the validator existed)
- **THEN** the response includes all of them — the filter matches
  `RULE_TYPE_DB_VALUES["THRESHOLD"] == ("SIMPLE", "THRESHOLD")`, not a single literal

#### Scenario: Updating a THRESHOLD rule's metric/operator/threshold via PUT
- **WHEN** `PUT /tenants/{id}/alert-rules/{rule_id}` is called on an existing
  THRESHOLD rule (loaded `rule.rule_type == "SIMPLE"`) with a new
  `metric`/`operator`/`threshold`
- **THEN** `normalize_rule_type("SIMPLE") == "THRESHOLD"` gates the update branch
  correctly and the fields are applied

### Requirement: Alarms use a Cumulocity-style ACTIVE → ACKNOWLEDGED → CLEARED lifecycle with server-enforced transitions
The system SHALL only allow `POST /alarms/{id}/acknowledge` on alarms currently
`status='ACTIVE'`, and `POST /alarms/{id}/clear` on alarms not already `CLEARED`
(i.e. from ACTIVE or ACKNOWLEDGED). `DELETE /alarms/{id}` is only permitted on
`CLEARED` alarms.

#### Scenario: Acknowledge an already-acknowledged alarm
- **WHEN** `POST /alarms/{id}/acknowledge` targets an alarm with `status='ACKNOWLEDGED'`
  or `'CLEARED'`
- **THEN** `400 Bad Request` — "Cannot acknowledge alarm in <status> state. Only
  ACTIVE alarms can be acknowledged."

#### Scenario: Delete a non-cleared alarm
- **WHEN** `DELETE /alarms/{id}` targets an `ACTIVE` or `ACKNOWLEDGED` alarm
- **THEN** `400 Bad Request` — "Only CLEARED alarms can be deleted. Clear the alarm
  first."

### Requirement: Auto-fired alarms dedupe on (alert_rule_id, device_id) via a partial unique index and UPSERT, tracking an occurrence count
The system SHALL, when the processor fires an alert (`fire_alert()` in
`mqtt_processor.py:477-555`), `INSERT ... ON CONFLICT (alert_rule_id, device_id)
WHERE status = 'ACTIVE' AND alert_rule_id IS NOT NULL AND device_id IS NOT NULL DO
UPDATE` against the `alarms` table (unique index `uq_alarms_active_rule_device`
from migration `020_alarms_active_dedup`) — re-firing the same rule for the same
device while an ACTIVE alarm already exists bumps
`context->>'occurrence_count'` instead of creating a duplicate row. Manually-created
alarms (via `POST /alarms`, which always has `alert_rule_id` possibly NULL) and
alarms cleared and re-fired later are unaffected by this dedup, since the partial
index only matches `status = 'ACTIVE'`. Every firing (dedup'd or not) still inserts
a new row into `alert_events` (append-only history — never deduped).

#### Scenario: Same rule fires 3 times for the same device before being cleared
- **WHEN** a THRESHOLD rule fires for a device 3 times in a row (cooldown expiring
  between each), with no acknowledgment/clear in between
- **THEN** exactly one `alarms` row exists (status ACTIVE) with
  `context->>'occurrence_count' = '3'`, while 3 separate `alert_events` rows exist
  recording each individual firing

#### Scenario: metric_name is nullable to support COMPOSITE firings
- **WHEN** a COMPOSITE rule fires (no single metric)
- **THEN** `alert_events.metric_name` is NULL (migration `018_alert_events_composite`
  dropped its NOT NULL constraint specifically for this case) and `alarms.alarm_type`
  is set to the literal string `"composite"`

### Requirement: Notification dispatch is fed by the MQTT processor and consumed asynchronously by the API
`processor/mqtt_processor.py::_queue_notification()` inserts a row into
`notification_queue` (raw SQL, `psycopg`) whenever a real-time alert fires.
`NotificationBackgroundTasks.process_notification_queue()`
(`api/app/services/background_tasks.py`) polls that table every 10 seconds and
runs each pending row through `NotificationDispatcher.process_alert_event()`
(`api/app/services/notification_dispatcher.py`), which is `async` and uses the
real async `RLSSession` (`self.session.execute(select(...))`, not SQLModel's
`.exec()`) it's actually constructed with, and resolves each alert event's rule
via `UnifiedAlertRule` — until fixed, it imported the plain `AlertRule` from
`app.models` (`app/models/base.py`, since deleted), a stale pre-unification
model mapped to the *same* `alert_rules` table with conflicting column
definitions (`active` as `String(1)` vs `UnifiedAlertRule`'s `Boolean`, no
`rule_type`/`severity`/`conditions`/`logic` columns at all) — harmless for
THRESHOLD rules (the common `metric`/`threshold` columns happened to line up)
but wrong for COMPOSITE rules. `NotificationDispatcher` has no
per-user muted-rules/quiet-hours suppression — `User` has no
`notification_preferences` column, and no such feature exists anywhere else in
the codebase (checked: no migration, no schema, no frontend UI) — so once a
`NotificationRule` enables a channel for a rule, every firing (outside the
per-channel throttle window) dispatches to it unconditionally.

#### Scenario: A notification_queue row is enqueued and the scheduler picks it up
- **WHEN** `mqtt_processor.py` inserts a `notification_queue` row with
  `status='pending'` after an alert fires, and the 10-second scheduler tick runs
- **THEN** `process_notification_queue()` marks the row `processing`, awaits
  `dispatcher.process_alert_event(...)`, which resolves the alert event, rule,
  device, and each enabled `NotificationRule` → `NotificationChannel` → `User`,
  skips channels within their throttle window, and sends through
  `ChannelFactory.create_service(channel.channel_type)` for the rest — then
  marks the queue row `completed`

#### Scenario: Channel send fails
- **WHEN** `_attempt_send()` returns `(False, error)` for a channel
- **THEN** the `Notification` row stays `status="pending"` with `error_message`
  set and `next_retry_at` one second out — picked up by
  `NotificationBackgroundTasks.retry_failed_notifications()` (a separate
  scheduled job operating directly on the `notifications` table with its own
  correct `session.execute()` calls, not through `NotificationDispatcher`)

### Requirement: Notification rules are a many-to-many join between one alert rule and one channel, unique per pair
The system SHALL enforce (in application code, not a DB constraint) that
`(alert_rule_id, channel_id)` is unique per tenant — `POST /notification-rules`
pre-checks for an existing row and returns `409` rather than relying on a DB unique
index (none exists on `notification_rules` for this pair).

#### Scenario: Duplicate rule+channel pair
- **WHEN** `POST /notification-rules` is called twice with the same
  `alert_rule_id`/`channel_id`
- **THEN** the second call returns `409 Conflict` — "Notification rule already
  exists for this alert rule and channel combination"

### Requirement: Notification channels default to unverified — no verification flow exists yet
`POST /tenants/{id}/notifications/channels` no longer hardcodes `verified=True`
— new channels get the model's own default (`False`). No verification flow
exists anywhere in the codebase (no confirmation email for `email` channels,
no test webhook ping for `webhook`/`slack`, `verified_at` is never set by any
code path) — `verified` is honest but currently inert (nothing gates behavior
on it; `PUT /channels/{id}` still lets a client set it directly either way).
Building a real verification flow (send a confirmation link/OTP, require a
callback) is unimplemented, tracked separately from this fix.
