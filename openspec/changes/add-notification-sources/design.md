## Context

The proposal establishes *why* the notification queue must stop being alarm-only.
This document is *how*, and it starts by correcting three things the proposal
asserts that the code does not support. Each was checked against the running
database and the current source on 2026-08-05.

**1. `get_management_tenant` does not resolve the management tenant.**
The proposal says it "already exists (`dependencies.py:167`), so the management
tenant is the recipient". It is a FastAPI dependency that reads a JWT and
*asserts* the caller's `tenant_type == 'management'`, raising 403 otherwise. It
performs no database lookup and returns the caller's own tenant id. The
ingestion-stall detector runs in a background task with no request and no token,
so it cannot use this function at all. Nothing in the codebase currently answers
"which tenant is the management tenant" from the database.

**2. `notification_queue.alert_event_id` carries a UNIQUE index, not just a FK.**
`uq_notification_queue_alert_event` is what makes queueing exactly-once per alert
event today. The proposal's plan to make the column nullable is correct, but
Postgres treats NULLs as distinct in a unique btree index — so every non-alert
row trivially satisfies it and the new sources inherit **no** duplicate
protection. A stall that flaps would queue a notification per tick.

**3. There are zero notification templates.** The `notification_templates` table
is empty, so `_send`'s `if template:` branch never runs in this deployment. The
live path is the fallback: `message = f"{device.name}: Alert triggered"`. The
proposal frames the work as "template selection ... where `alert_type` finally
has to mean something", which is true but insufficient — a stall notification has
no device, and with no template configured it would render as
`None: Alert triggered`. The fallback must become source-aware or the feature
ships broken by default.

Current state otherwise: one tenant exists (`Demo Tenant`), it *is* the
management tenant, and it has exactly one enabled channel (email). So there is a
real recipient, and the multi-tenant recipient question is presently degenerate —
which is a reason to get the resolution rule right now rather than to skip it.

## Goals / Non-Goals

**Goals:**
- A notification can be *about* something that is not an `AlertEvent`, without
  synthesising one.
- The ingestion stall — already detected correctly, already the cause of two
  outages — reaches a person.
- A pending command approval reaches someone who is not signed in.
- Non-alarm sources get the same exactly-once guarantee alarms already have.
- Failing to notify never fails the thing being notified about.

**Non-Goals:**
- Replacing external monitoring. An in-platform notification cannot report that
  the platform is down. `docs/GRAFANA.md` covers that and stays the primary
  signal for the stall; this is the second, not the first.
- Per-user notification preferences, digesting, or quiet hours.
- Backfilling notifications for stalls or approvals that already happened.
- A UI for the new sources. The existing Notifications page lists rows; it does
  not need to change to make delivery work.

## Decisions

### D1 — `source_kind` is a discriminator column, not a nullable-FK inference

`notification_queue` gains `source_kind TEXT NOT NULL DEFAULT 'alert_event'` and
`payload JSONB`. `alert_event_id` becomes nullable. Readers branch on
`source_kind`, never on `alert_event_id IS NULL`.

*Why not infer from the null FK:* the same reason `transport.mode` and
`downlink_mode` are explicit elsewhere in this codebase — a second non-alert
source that also happens to have a null FK is indistinguishable from the first,
and the reader has no way to know which payload shape it is holding. A
discriminator makes adding the third source a data change; inference makes it a
rewrite.

*Alternative rejected:* separate tables per source. That duplicates status,
retry, throttling and the queue processor three times over, which is the
duplication this change exists to avoid.

### D2 — Idempotency comes from a partial unique index on a source-supplied key

Add `dedupe_key TEXT` and:

```sql
CREATE UNIQUE INDEX uq_notification_queue_source_dedupe
  ON notification_queue (source_kind, dedupe_key)
  WHERE alert_event_id IS NULL AND dedupe_key IS NOT NULL;
```

The existing `uq_notification_queue_alert_event` is left exactly as it is, so
alarm behaviour is untouched.

*Why an index and not a check in the raiser:* identical to the reasoning behind
`uq_device_commands_inflight_opcode` in the driver work — two ticks of the stall
detector arriving concurrently would both read "nothing queued" and both insert.
The database is the only place that decision is safe.

*Dedupe keys:* the stall source uses the transition it is reporting
(`stall:{stalled|recovered}:{iso8601 of the transition}`), so the edge-trigger
and the index agree on what "the same event" means. The approval source uses
`approval:{command_id}`, which is naturally once-per-request.

### D3 — The management tenant is resolved from the database, and ambiguity is an error

New `resolve_platform_notification_tenant(session) -> UUID | None` in
`app/services/notification_dispatcher.py`:

```sql
SELECT id FROM tenants WHERE tenant_type = 'management'
```

- exactly one → that tenant receives platform faults
- **zero** → log an error and queue nothing. A platform with no management tenant
  has nobody to tell; inventing a recipient would mean notifying an arbitrary
  customer about our infrastructure.
- **more than one** → log an error naming all of them and queue nothing. Nothing
  in the schema enforces uniqueness (verified: no constraint), so this is
  reachable, and picking one arbitrarily would deliver to a tenant that changes
  identity between deploys.

*Why not a config setting:* a `PLATFORM_NOTIFICATION_TENANT_ID` env var would
drift from the database's own idea of which tenant is management, and the failure
is silent — notifications route to a tenant that no longer exists. The column
already carries the fact.

### D4 — The fallback message becomes source-aware, before template selection is touched

`_send`'s no-template branch currently hardcodes an alarm sentence. Since the
template table is empty in this deployment, that branch **is** the live path, so
it is fixed first and independently: each source supplies its own default subject
and body from its `payload`, and the alarm default is unchanged.

Template selection then gains `alert_type` matching, preferring an enabled
template whose `alert_type` matches the source and falling back to one with
`alert_type IS NULL` — so today's single-template-per-channel setups keep working
exactly as they do.

*Ordering matters:* doing template selection first and the fallback second would
ship a window in which a stall notification renders as `None: Alert triggered`.

### D5 — Raising a notification never fails its caller

Every raise site wraps in `try/except Exception` and logs. The stall detector
must keep detecting if the queue insert fails; a command must still enter
`awaiting_approval` if we cannot announce it. An approval that is queued but
un-announced is recoverable — the queue page still shows it. An approval that was
refused because notification failed is a device command silently lost.

*Consequence to accept:* a notification can be missed with only a log line as
evidence. That is strictly better than today, where there is no notification at
all, and it is the reason Grafana remains the primary stall signal (D-Non-Goal 1).

### D6 — The stall source fires on the transition, both ways

Reuses the existing `_ingestion_stalled` edge-trigger in `background_tasks.py`:
one notification when the fleet goes silent, one when it recovers. Not per tick.

*Why recovery too:* a "stalled" message with no matching "recovered" trains the
reader to ignore the channel, because they cannot tell a live incident from an
old one. This session is the evidence — ingestion was stalled for roughly four
hours, recovered on its own, and the only way anyone learned either fact was by
running a health check by hand.

## Risks / Trade-offs

- **A mistake here breaks alarm delivery, not just the new sources.** →
  `process_alert_event` keeps its signature and its code path; the new entry
  point is additive and shares only `_is_throttled`, `_attempt_send` and channel
  resolution. The existing `api/tests/test_notification_dispatcher.py` must pass
  unchanged — if it needs editing, the change went too far.
- **Migration makes a NOT NULL column nullable.** → Additive and reversible in
  the forward direction; the downgrade must refuse if any row has
  `alert_event_id IS NULL`, rather than deleting rows to satisfy the constraint.
- **Throttling was written per (channel, alert_rule).** → A non-alarm source has
  no `alert_rule`, so `_is_throttled` cannot be reused as-is. Throttle
  non-alarm sources per `(channel, source_kind)` instead; the dedupe index (D2)
  is the real duplicate guard, and throttling is only a rate ceiling.
- **One channel, one tenant, no templates in this deployment.** → The feature is
  testable end to end here, but the multi-tenant recipient rule and the
  template-selection rule are exercised only by unit tests. Both are written to
  fail loudly (D3) rather than guess.
- **Grafana covers the stall too.** → Deliberate overlap, stated in the proposal.
  Two notifications for one stall is a smaller problem than none.

## Migration Plan

1. Migration `033`: add `source_kind` (NOT NULL DEFAULT `'alert_event'`),
   `payload` (JSONB NULL), `dedupe_key` (TEXT NULL); drop NOT NULL on
   `alert_event_id`; add the partial unique index from D2. Existing rows are
   correct by the default — every current row *is* an alert event.
2. Deploy the dispatcher change with no raise sites wired. Alarm delivery must be
   verified green before anything raises.
3. Wire the stall source, then the approval source, separately.

**Rollback:** the reverse migration drops the new columns and index and restores
NOT NULL — which it can only do if no non-alert rows exist, so it must delete
them explicitly and say so, or refuse. Refusing is the default; deleting queued
notifications to satisfy a constraint is how a rollback becomes an incident.

## Open Questions

- **Which channel types should platform faults reach?** Email is the only
  configured type. Slack is arguably better for a stall, but there is no Slack
  channel configured to test against, so this design does not special-case it.
- **Should the approval source respect the 24-hour lapse window** by not
  notifying for a request already close to expiry? Left out; a late notification
  is still information, and the queue page shows the real deadline.
