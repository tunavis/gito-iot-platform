# Alarm Engine Unification — Design

**Date:** 2026-07-06 · **Status:** Approved design, Phase-1 workstream #1 (see docs/strategy/2026-07-05-platform-5yr-strategy.md §4a)
**Shaped for:** ~2h/day capacity — five independently shippable steps, each leaves the system better.

## 1. Verified current state (all file:line checked 2026-07-06)

**The only live evaluation path:**
```
MQTT / ChirpStack bridge → Redis stream → processor.evaluate_alerts()
  → DatabaseService.get_active_alert_rules()        processor/mqtt_processor.py:452
      SQL: WHERE device_id = %s AND active = true
      SELECT id, metric, operator, threshold, cooldown_minutes, last_fired_at
  → AlertEvaluator.should_fire_alert()               processor/mqtt_processor.py:607
  → fire_alert(): INSERT alert_events + last_fired_at        :472
  → Redis publish_alert + INSERT notification_queue (ON CONFLICT DO NOTHING)  :1359
  → API background task → NotificationDispatcher → channels   (this part is fine)
```

**Defects (each independently verified):**

**Ingest paths inventory (the platform is multi-protocol — this table is the contract):**

| Path | Protocol | Evaluated today? |
|---|---|---|
| Direct MQTT devices (`+/devices/+/telemetry`, processor:1573) | MQTT | ✅ |
| ChirpStack uplinks, local broker (`application/+/…/up`, processor:1577) | LoRaWAN | ✅ |
| ChirpStack outbound bridge workers (processor:962) | LoRaWAN | ✅ |
| HTTP device-token ingest (`POST /ingest`, device_ingest.py:39) | HTTP | ❌ |
| HTTP gateway batch ingest (`POST /ingest/gateway`, device_ingest.py:198) | HTTP | ❌ |
| LoRaWAN provider webhooks — TTN/universal (`POST /lorawan/{provider}`, lorawan_ingest.py:75) | LoRaWAN | ❌ |
| Future: Modbus/OPC-UA/S7 via Edge Gateway, Sparkplug B (strategy §7) | industrial | must join the funnel |

| # | Defect | Evidence |
|---|---|---|
| D1 | **Any telemetry ingested via the REST API gets NO alarm evaluation — regardless of protocol** (HTTP token, HTTP gateway, AND TTN/webhook LoRaWAN). These routes write `Telemetry` rows directly; nothing in api/app calls stream_add/XADD | device_ingest.py:111,180; lorawan_ingest.py:75; grep for XADD in api/ = 0 hits |
| D2 | **COMPOSITE rules never fire** — unified router stores them in `alert_rules` (conditions JSONB + logic), but the processor SELECT omits those columns and the loop does `if metric_name not in payload: continue` (metric is NULL for composite) | models/unified_alert_rule.py:89; processor:460,1316 |
| D3 | **Global rules (device_id NULL) never fire** — processor filters `WHERE device_id = %s`; the unified router explicitly supports device_id=null "global" rules | processor:462; alert_rules_unified.py docstring |
| D4 | **severity is dropped at firing** — alert_events insert carries no severity; the `alarms` lifecycle table (ack/clear workflow, UI) is NEVER auto-populated by rule firings — only manual CRUD via alarms router | processor:486; grep "Alarm(" = models/routers/schemas only |
| D5 | **Dead sophisticated engine** — `AlertRuleEvaluationEngine` (composite + weighted scoring) has ZERO callers; its `_is_in_cooldown` is a stub returning False; `evaluate_rule_preview` is the known "preview returns empty" TODO | api/app/services/alert_rule_engine.py; caller grep = 0 |
| D6 | **Dead copy-pasted EmailService in processor** — `send_alert_email` is never called (superseded by notification_queue) | processor:102; call grep = 0 |
| D7 | **Legacy composite tables** — `composite_alert_rules` + `alert_rule_conditions` exist in DB alongside the JSONB columns; nothing reads them | pg_tables; grep = models only |

## 2. Target architecture

**One evaluation point, one evaluation library, every ingest path feeds it — protocol-neutral by
construction.** A device's alarm behavior must never depend on how its data arrived. Any future
protocol (Modbus, OPC-UA, S7, Sparkplug B, CoAP, camera events) gets alarms for free by publishing
to the funnel; nothing else to build.

```
ALL ingest paths (direct MQTT · ChirpStack local · ChirpStack bridges ·
                  HTTP token · HTTP gateway · LoRaWAN provider webhooks ·
                  future Edge Gateway drivers)
        └─→ Redis stream (telemetry:ingest)          ← single funnel (fixes D1)
              └─→ processor StreamConsumer
                    └─→ alarm_core.evaluate(rules, payload, now)   ← shared pure library
                          └─→ firing pipeline:
                                1. INSERT alert_events (with severity)
                                2. UPSERT alarms row (auto lifecycle, dedup on
                                   (rule_id, device_id) while an alarm is ACTIVE)   ← fixes D4
                                3. INSERT notification_queue (unchanged)
                                4. Redis publish_alert (unchanged)
```

**`alarm_core` — a pure-Python package** (no SQLAlchemy, no psycopg, no I/O):
- `evaluate(rules: list[Rule], payload: dict, now: datetime) -> list[Firing]`
- Handles: THRESHOLD ops (>, <, >=, <=, ==, !=), COMPOSITE (conditions JSONB +
  AND/OR + weighted score — port from the dead API engine, it's good code), cooldown
  (last_fired_at + cooldown_minutes), None-safety, global vs device-scoped rules.
- Lives at `shared/alarm_core/` with its own pyproject; installed into BOTH images
  (api + processor Dockerfiles add `COPY shared/ …` — compose build context moves up
  one level to repo root; this is the only infra change).
- Pure functions → trivially unit-testable; the API's preview endpoint (D5's TODO)
  becomes: fetch history → replay through `alarm_core.evaluate` → count firings.
  The stub gets fixed almost for free.

**Rule fetch (processor) becomes:**
```sql
SELECT id, rule_type, metric, operator, threshold, conditions, logic,
       severity, cooldown_minutes, last_fired_at
FROM alert_rules
WHERE active = true AND tenant_id = %s
  AND (device_id = %s OR device_id IS NULL)          -- fixes D3
```
(keep per-(tenant,device) result cached in-process ~30s — same pattern as unit_map cache —
so global rules don't multiply query load.)

## 3. Implementation plan — five shippable steps

Each step is one PR-sized unit, independently deployable, sized 1–3 sessions at 2h.

**Step 1 — `alarm_core` library + tests (pure code, no wiring).**
Create `shared/alarm_core/` with Rule/Firing dataclasses + `evaluate()`. Port threshold
logic from processor AlertEvaluator and composite/weighted logic from the dead API engine.
pytest suite: operators, None metric, cooldown boundaries, composite AND/OR, weights,
global rules, empty conditions. **Done when:** suite green in CI; nothing imports it yet.

**Step 2 — processor adopts alarm_core (fixes D2, D3, severity fetch). ✅ DONE 2026-07-06**
Compose build context → repo root for processor; Dockerfile installs shared/alarm_core.
Replaced AlertEvaluator + widened the SQL as above (with 30s per-(tenant,device) rule
cache, invalidated on firing). Discovered during implementation and fixed here:
- Evaluation ran on the MQTT *publish* side, not in the stream consumer — moved into
  StreamConsumer._process_entries so the stream is truly the single funnel (this is
  what makes Step 3 automatic for REST routes).
- DB stores legacy rule_type names (SIMPLE/COMPLEX) and symbol operators — normalized
  at the row→Rule mapping / by alarm_core's operator aliases.
- **D8 (new):** notification_queue had no unique constraint on alert_event_id, so the
  processor's ON CONFLICT enqueue failed silently — notifications from fired alerts
  never dispatched. Fixed by migration 019 (dedup + unique index).
- metric_name made nullable for composite firings (migration 018).
Verified e2e on bench tenant: THRESHOLD (regression), COMPOSITE ("2/2 conditions met,
score 100%", CRITICAL), and GLOBAL rules all fired from one injected stream entry;
notification_queue rows created and consumed by the dispatcher.

**Step 3 — ALL REST ingest routes funnel into the stream (fixes D1). ✅ DONE 2026-07-06**
All three routes now publish via `app/services/telemetry_stream.stream_ingest()` instead
of direct ORM inserts; the consumer inserts + evaluates. Kept synchronous: validation,
key mapping, last_seen/status updates, WS publish + twin cache; kept 201 status codes
(devices in the field may check == 201). Redis unavailable → 503 so devices retry.
Verified e2e per route: token ingest fired a CRITICAL threshold alarm + queued
notification; LoRaWAN webhook (custom provider) fired an alarm with __lora_* radio
metrics stored; gateway fan-out fired a GLOBAL rule for a sub-device.
Also fixed pre-existing bugs found during verification:
- Gateway route's batch last_seen UPDATE always 500'd: `ANY(:ids::uuid[])` breaks
  SQLAlchemy's named-param parser → `ANY(CAST(:ids AS uuid[]))`.
- (Local env) `resolve_device_token` SQL function was missing despite alembic head —
  legacy of the phantom-revision reset; re-applied from migration 006.

**Step 4 — alarms lifecycle auto-population (fixes D4). ✅ DONE 2026-07-07**
fire_alert now UPSERTs `alarms` in the same transaction as the alert_event: a new
ACTIVE alarm per (rule_id, device_id), else an occurrence bump. Severity flows through.
Deviations from the original plan (the table lacked the assumed columns):
- No occurrence_count/last_seen columns exist → occurrence tracking lives in the
  `context` JSONB (occurrence_count, last_value, last_seen_event_id); no schema churn.
- Dedup via migration 020 partial unique index `(alert_rule_id, device_id)
  WHERE status='ACTIVE'` + `ON CONFLICT … DO UPDATE`.
- asyncpg needs explicit casts on bare params inside jsonb_build_object
  (`%s::text` / `%s::double precision`) or it errors "cannot determine type".
- Guarded the "Alert fired" log + publish/notify on alert_event_id — a rolled-back
  firing no longer logs success or emits a phantom notification.
Verified e2e: threshold rule fired 3× (cooldown bypassed) → exactly ONE ACTIVE alarm,
occurrence_count=3, last_value=28, 3 alert_events; composite firing → ACTIVE alarm
(alarm_type 'composite', rule_type COMPOSITE); both returned by the alarms API
(`GET /alarms?status=ACTIVE`). Ack/clear untouched (existing router).

**Step 5 — deletion + preview fix (D5, D6, D7).**
Delete processor EmailService (dead), delete API AlertRuleEvaluationEngine (logic now
lives in alarm_core), rewrite preview endpoint on alarm_core replay (closes the
CLAUDE.md TODO), migration to DROP composite_alert_rules + alert_rule_conditions
(after a row-count check confirms empty/stale). **Done when:** grep shows one evaluator
in the codebase; preview returns real counts.

## 4. Rollout & risk

| Risk | Mitigation |
|---|---|
| Step 2 changes firing behavior for existing rules | alarm_core unit tests mirror current threshold semantics exactly first; bench tenant e2e before deploy; cooldown semantics preserved (last_fired_at) |
| Step 3 makes HTTP ingest async — client sees 202 before DB write | acceptable (matches MQTT semantics); document in API docs; keep validation synchronous so bad payloads still 4xx |
| Build-context change breaks CI images | do it as the first commit of Step 2, deploy staging before the logic swap |
| Global-rule fan-out surprises tenants with old forgotten rules | log firings with rule origin for first week; release note |
| alarms UPSERT races under burst | unique partial index `(rule_id, device_id) WHERE status='ACTIVE'` + ON CONFLICT |

**Out of scope (explicitly):** asset-scoped alarms (Phase-1 step 2 of strategy),
hysteresis/deadband, insight events (F4-lite plugs into this same pipeline later —
that's the point of doing this first).
