## Why

This platform has no generic notification path. `NotificationDispatcher` exposes
exactly one entry point, `process_alert_event(alert_event_id)`, and
`notification_queue.alert_event_id` is `NOT NULL` with a foreign key to
`alert_events`. **Every notification the product can send must first be an
alarm.**

Two callers are now blocked on that, and they arrived from opposite directions:

**Telemetry ingestion stalls are detected and then told to nobody.**
`check_ingestion_stall` correctly identifies the case per-device offline
detection structurally cannot see — the ingest path itself dying, so every
device goes offline *correctly* and no single device looks wrong. It works. Its
entire output is a `logger.error` into a container log, marked in the source as
a known ceiling: *"ponytail: log-only. Hook a notification/page in right here if
a stall ever needs to wake someone up"* (`background_tasks.py:610`). It needed
to. A dropped MQTT subscription ate 43h of telemetry across all 68 devices
unnoticed, and an 11-hour outage repeated it. The detector was not the missing
piece; delivery was.

**Agent command approvals are findable but not announced.**
`add-command-approval-ui` shipped a queue and a sidebar count. Someone who is
not signed in learns nothing, and a request lapses after 24 hours in silence.
For a gate whose entire purpose is that a human looks, "the human happened to be
logged in" is a weak guarantee.

The constraint will keep biting past these two — invitations, billing events,
firmware campaign outcomes and quota warnings all want to tell someone something
that is not an alarm. Each faces the same choice this change exists to settle
properly: widen the pipeline, or fake an `AlertEvent` and corrupt what
`alert_events` means.

## What Changes

- **BREAKING (schema)**: `notification_queue.alert_event_id` becomes nullable,
  with a companion `source_kind` and `payload` so a queued notification can
  describe something that is not an alert event. Existing rows are unaffected and
  keep `source_kind='alert_event'`.
- **New** a second entry point on `NotificationDispatcher` for non-alarm
  notifications, sharing the existing channel resolution, throttling and retry
  rather than duplicating them.
- **New** a platform-health source, raised on the ingestion-stall transition that
  today only logs — once when the fleet goes silent and once when it recovers,
  matching the existing `_ingestion_stalled` edge-trigger so the message means
  "this just broke" rather than "still broken, tick 517".
- **New** an approval-pending notification, raised once when a command enters
  `awaiting_approval` and never on approve or reject — a notification per
  decision turns an alert into a log.
- **Modified** template selection, which currently picks the single enabled
  template per `channel_type` and ignores `alert_type`. A non-alarm notification
  needs to reach a different template than a critical alarm does, so this is where
  the stored-but-unused `alert_type` finally has to mean something.

## Capabilities

### New Capabilities
- `notification-sources`: what a notification can be *about*, how a non-alarm
  source is queued and rendered, and the guarantee that failing to notify never
  fails the thing being notified about.

### Modified Capabilities
- `alarms-and-alerting`: the notification queue stops being alarm-only, and
  template selection stops assuming one enabled template per channel.
- `command-approval`: completes the requirement deliberately left partial —
  a pending request reaches someone who is not signed in.
- `telemetry-ingestion`: a detected stall acquires a delivery path instead of
  terminating in a log line.

## Impact

**Database** — `notification_queue`: nullable `alert_event_id`, new `source_kind`
and `payload`. Backfill `source_kind='alert_event'` for existing rows, which is
safe because that is what every existing row is.

**API/services** — `app/services/notification_dispatcher.py` (second source,
shared send path), `app/services/background_tasks.py` (queue processing must
handle a row with no alert event; `detect_ingestion_stall` raises instead of only
logging), `app/routers/commands.py` (raise on entry to `awaiting_approval`).

**Who receives a platform fault** — the management tenant, not every tenant. A
stall crosses tenants by construction (`check_ingestion_stall` reads
`max(devices.last_seen)` fleet-wide, and its docstring is explicit that a stall
is a platform fault, not a tenant's), but `notification_queue.tenant_id` is
`NOT NULL` and `notification_channels` are per-user-per-tenant, so a
tenant-less notification is not representable. It does not need to be:
`get_management_tenant` and `Tenant.parent_tenant_id` already exist
(`dependencies.py:167`), so the management tenant is the recipient and
`tenant_id` stays `NOT NULL`. Fanning a platform fault out to every tenant's
admins would be worse than useless — they cannot act on it, and the one person
who can would be told twenty times.

**Risk to weigh in design** — this touches the path that delivers alarm
notifications, which is the platform's most operationally important side effect.
The migration is additive but the dispatcher change is not: a mistake here fails
alarm delivery, not just approval delivery. That is the reason this is its own
change and not a task inside a UI feature.

**Explicitly rejected, and recorded so it is not revisited casually** —
synthesising an `AlertEvent` per non-alarm notification. It requires no migration
and would immediately put approval requests, invitations and billing events into
alarm counts, alert trends, and every existing aggregation over `alert_events`.
For the ingestion stall it is worse still: an `AlertEvent` requires a `device_id`
(`NOT NULL`), so a platform-wide fault would have to be blamed on one arbitrarily
chosen device. Changing what existing data means in order to avoid changing a
schema is a cost that comes due later, somewhere else, to someone else.

**Not a substitute for external monitoring.** An in-platform notification cannot
report that the platform is down, because it is the platform. `/api/health`
already reports `degraded` with `checks.ingestion.status: "stalled"`,
unauthenticated and with no code change, and an external monitor watching it
covers both the stall and the case this change structurally cannot. See
`docs/setup/UPTIME_MONITORING.md`. The two are complementary; shipping this
change is not a reason to skip that one.

## Status

**Proposed, not planned.** Design and tasks are still unwritten.

The sequencing question this proposal originally left open — *does this wait for
a real second caller, or land before the approval gate is relied on?* — is
answered: the ingestion stall is the real second caller, it is already built and
already detecting correctly, and it has two outages behind it rather than a
hypothetical. That also settles the priority between the two sources. Approval
delivery is the feature; stall delivery is the one with evidence.

Renamed from `add-approval-notifications` once the stall became the second
source, since the change is about what a notification may be *about* — which is
what its own new capability was already called.
