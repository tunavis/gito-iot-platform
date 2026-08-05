# Tasks

Sequenced so alarm delivery — the platform's most operationally important side
effect — is verified green before anything new raises into it. Groups 1–3 change
no behaviour on their own.

## 1. Schema

- [x] 1.1 Migration `033`: on `notification_queue` add `source_kind TEXT NOT NULL
      DEFAULT 'alert_event'`, `payload JSONB NULL`, `dedupe_key TEXT NULL`; drop
      `NOT NULL` from `alert_event_id`. Existing rows are correct by the default
      — every current row *is* an alert event.
- [x] 1.2 Add the partial unique index, and leave
      `uq_notification_queue_alert_event` untouched:
      ```sql
      CREATE UNIQUE INDEX uq_notification_queue_source_dedupe
        ON notification_queue (source_kind, dedupe_key)
        WHERE alert_event_id IS NULL AND dedupe_key IS NOT NULL;
      ```
- [x] 1.3 Downgrade **refuses** if any row has `alert_event_id IS NULL`, rather
      than deleting to satisfy the restored constraint. Deleting queued
      notifications to make a rollback succeed is how a rollback becomes an
      incident.
- [x] 1.4 Model updated to match, in the same commit as the migration.

## 2. Resolving who hears about a platform fault

- [x] 2.1 `resolve_platform_notification_tenant(session)` — selects tenants with
      `tenant_type='management'`. **Not** `get_management_tenant`, which reads a
      JWT and asserts the *caller's* type; a background task has no token and
      that function performs no lookup.
- [x] 2.2 Zero matches → log and return None. One → return it. More than one →
      log all candidates and return None. Nothing enforces uniqueness, so both
      failure modes are reachable and neither has a safe guess.
- [x] 2.3 Unit tests for all three cases. The deployment has exactly one tenant
      and it is management, so zero and many are reachable only in tests.

## 3. The dispatcher's second entry point

- [x] 3.1 Fix the no-template fallback **first**, on its own. It is the live path
      (`notification_templates` is empty), and it hardcodes
      `f"{device.name}: Alert triggered"` — a stall has no device and would
      render `None: Alert triggered`. Each source supplies its own default
      subject and body; the alarm default is unchanged.
- [x] 3.2 `process_platform_event(source_kind, payload, dedupe_key)` alongside
      `process_alert_event`, sharing channel resolution, `_attempt_send` and the
      send/retry bookkeeping. `process_alert_event` keeps its signature and its
      path.
- [x] 3.3 Throttle non-alarm sources per `(channel, source_kind)`.
      `_is_throttled` keys on `(channel, alert_rule)` and a non-alarm source has
      no rule. The dedupe index is the duplicate guard; throttling is only a rate
      ceiling.
- [x] 3.4 Template selection: prefer an enabled template whose `alert_type`
      matches, fall back to one with `alert_type IS NULL`. A tenant with one
      untyped enabled template per channel must see no change.
- [x] 3.5 Queue processing handles a row with no alert event without attempting
      an alert lookup.
- [x] 3.6 **`api/tests/test_notification_dispatcher.py` passes unedited.** If it
      needs changing, the change went further than intended — treat that as a
      signal, not a chore.

## 4. Verify alarm delivery is still green — before anything raises

- [x] 4.1 Full API suite green (451 as of `0302118`; this change adds to that).
- [x] 4.2 Fire a real alarm end to end and confirm it still delivers to the one
      configured email channel. Deploying groups 1–3 without this is deploying an
      untested change to the alarm path.

## 5. The stall source

- [ ] 5.1 Raise on the existing `_ingestion_stalled` edge-trigger in
      `background_tasks.py` — on entering stalled and on recovering, not per
      tick. `dedupe_key = stall:{state}:{iso8601 of the transition}`.
- [ ] 5.2 Replace the `ponytail: log-only` comment at `background_tasks.py:610`
      with the delivery it asked for.
- [ ] 5.3 Wrap the raise in `try/except` and log — detection must survive the
      queue being unavailable.
- [ ] 5.4 `idle` (no device has ever reported) raises nothing. A fresh deployment
      is not a fault.
- [ ] 5.5 Tests, including that a persisting stall raises once.

## 6. The approval source

- [ ] 6.1 Raise on entry to `awaiting_approval` in `routers/commands.py`, once
      per request, `dedupe_key = approval:{command_id}`.
- [ ] 6.2 Nothing raised on approve or reject.
- [ ] 6.3 Wrapped in `try/except` — the command must be recorded even if the
      announcement fails. A request nobody was told about is recoverable; a
      command silently refused is not.
- [ ] 6.4 Message names the device, the command and the agent's stated reason —
      the reason exists to be shown to the approver.
- [ ] 6.5 Tests.

## 7. Close out

- [ ] 7.1 Verify end to end on the running stack: trigger a stall (stop the
      processor rather than touching the live broker — tooling does not publish
      to `mqtt.cordys.co.za`), confirm one notification and one on recovery.
- [ ] 7.2 Confirm the Grafana stall alert in `docs/GRAFANA.md` still stands as
      the primary signal. This change does not replace it and shipping it is not
      a reason to skip that one — an in-platform notification cannot report that
      the platform is down.
- [ ] 7.3 Update `CLAUDE.md`: the queue is no longer alarm-only, and `alert_type`
      now selects templates.

## Blocked / awaiting external input

- [ ] 10.1 Slack is arguably the better channel for a platform fault, but none is
      configured, so this change does not special-case channel type. Revisit when
      one exists.
