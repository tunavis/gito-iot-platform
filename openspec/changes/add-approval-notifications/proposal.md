## Why

`add-command-approval-ui` makes a pending agent command **findable** — a queue and
a sidebar count. It does not make it **announced**. Someone who is not signed in
learns nothing, and a request lapses after 24 hours in silence. For a gate whose
entire purpose is that a human looks, "the human happened to be logged in" is a
weak guarantee.

The obvious fix — raise a notification — turned out to be blocked by something
worth fixing on its own terms: **this platform has no generic notification path.**
`NotificationDispatcher` exposes exactly one entry point,
`process_alert_event(alert_event_id)`, and `notification_queue.alert_event_id` is
`NOT NULL` with a foreign key to `alert_events`. Every notification the product
can send must first be an alarm.

That constraint will keep biting. Approval requests are the first caller to hit
it; invitations, billing events, firmware campaign outcomes and quota warnings all
want to tell someone something that is not an alarm. Each will face the same
choice this change exists to settle properly: widen the pipeline, or fake an
`AlertEvent` and corrupt what `alert_events` means.

## What Changes

- **BREAKING (schema)**: `notification_queue.alert_event_id` becomes nullable,
  with a companion `source_kind` and `payload` so a queued notification can
  describe something that is not an alert event. Existing rows are unaffected and
  keep `source_kind='alert_event'`.
- **New** a second entry point on `NotificationDispatcher` for non-alarm
  notifications, sharing the existing channel resolution, throttling and retry
  rather than duplicating them.
- **New** an approval-pending notification, raised once when a command enters
  `awaiting_approval` and never on approve or reject — a notification per decision
  turns an alert into a log.
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

## Impact

**Database** — `notification_queue`: nullable `alert_event_id`, new `source_kind`
and `payload`. Backfill `source_kind='alert_event'` for existing rows, which is
safe because that is what every existing row is.

**API/services** — `app/services/notification_dispatcher.py` (second source,
shared send path), `app/services/background_tasks.py` (queue processing must
handle a row with no alert event), `app/routers/commands.py` (raise on entry to
`awaiting_approval`).

**Risk to weigh in design** — this touches the path that delivers alarm
notifications, which is the platform's most operationally important side effect.
The migration is additive but the dispatcher change is not: a mistake here fails
alarm delivery, not just approval delivery. That is the reason this is its own
change and not a task inside a UI feature.

**Explicitly rejected, and recorded so it is not revisited casually** —
synthesising an `AlertEvent` per non-alarm notification. It requires no migration
and would immediately put approval requests, invitations and billing events into
alarm counts, alert trends, and every existing aggregation over `alert_events`.
Changing what existing data means in order to avoid changing a schema is a cost
that comes due later, somewhere else, to someone else.

## Status

**Proposed, not planned.** Raised while implementing `add-command-approval-ui`,
which is shipping without it. Design and tasks are deliberately not written yet —
the sequencing question (does this wait for a real second caller, or land before
the approval gate is relied on?) should be answered before the how.
