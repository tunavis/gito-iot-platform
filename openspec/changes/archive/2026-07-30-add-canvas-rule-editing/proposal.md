## Why

`add-visual-automation-canvas` shipped a canvas that *draws* an alert rule's
trigger→action path and lets you wire a notification channel by dragging. It
deliberately stopped there: every other edit still goes through the form pages.

In use that reads as half a feature. A user who sees `flow_rate > 80` on a node
tries to click it and change `80`. They see an `AND (3)` pill and try to click it
to make it `OR`. Today both open a form elsewhere on the page. Competitors
(n8n, ThingsBoard rule chains) edit in place, and the gap is the first thing
anyone notices.

Most of that gap needs no new backend. `PUT /tenants/{id}/alert-rules/{id}`
already accepts `metric`/`operator`/`threshold` for THRESHOLD rules and
`conditions`/`logic` for COMPOSITE ones (`alert_rules_unified.py:333-347`). The
canvas simply never calls it.

One thing does need the backend: the router gates condition writes on the rule
*already* being COMPOSITE, and `AlertRuleUpdate` has no `rule_type` field
(`alert_unified.py:75-91`). So "add a second condition" to a THRESHOLD rule —
the single most obvious action on a one-condition graph — is currently
impossible to express. That is why this is a separate change:
`add-visual-automation-canvas` asserts frontend-only by construction, and this
one is not.

## What Changes

- **Condition nodes become editable in place.** Clicking a condition node opens a
  small popover on the canvas with metric / operator / threshold (and weight for
  COMPOSITE). Saving issues the existing `PUT`. The full rule form stays
  reachable for name, severity, description, and cooldown.
- **The logic node toggles.** Clicking the `AND`/`OR` pill flips
  `alert_rules.logic` via the same `PUT`. COMPOSITE rules only — a THRESHOLD
  rule has no logic node to click.
- **Add and remove conditions.** A `+` affordance appends to `conditions[]`;
  removing a condition node deletes its entry. COMPOSITE rules only, until the
  conversion below.
- **Explicit THRESHOLD → COMPOSITE conversion.** Adding a second condition to a
  THRESHOLD rule converts it, behind a confirmation that names what happens.
  It is never silent: the rule type is user-visible on the list page and in the
  badge, so changing it behind a `+` would be a lie.
- **Backend:** `rule_type` becomes an accepted field on `AlertRuleUpdate`, and
  the update router learns to apply a THRESHOLD→COMPOSITE transition
  (set `rule_type`, `conditions`, `logic`; leave `device_id` alone).

### Scope of the conversion

`device_id` is deliberately **preserved**. The processor selects rules with
`WHERE ... AND (device_id = %s OR device_id IS NULL)` irrespective of rule type
(`mqtt_processor.py:477-488`), so a converted rule keeps exactly the device scope
it had. `evaluate()` dispatches on the normalized rule type
(`shared/alarm_core/alarm_core/engine.py:156`), so the converted rule is
evaluated by `_evaluate_composite` from the next telemetry message. No migration,
no backfill, no change to `alarm_core` itself.

COMPOSITE → THRESHOLD is **not** offered. It would have to discard conditions
and invent a single metric/operator/threshold from them; there is no correct
answer for a 3-condition rule, and the form path can already delete and recreate.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `alarms-and-alerting`: the canvas gains in-place editing of a rule's
  conditions and logic, and a rule may be converted from THRESHOLD to COMPOSITE.
  Evaluation semantics are unchanged — a converted rule is evaluated by the
  composite path that already exists.

## Impact

- `api/app/schemas/alert_unified.py` — `rule_type` added to `AlertRuleUpdate`.
- `api/app/routers/alert_rules_unified.py` — update handler applies a
  THRESHOLD→COMPOSITE transition and then treats the rule as COMPOSITE for the
  rest of the request.
- `web/src/components/flow/RuleCanvas.tsx` — node click opens the editor
  popover; save/add/remove/toggle call the existing endpoint.
- `web/src/components/flow/nodes/RuleNodes.tsx` — condition and logic nodes gain
  edit affordances; a `+ Add condition` node.
- `web/src/app/dashboard/alert-rules/page.tsx` — refetch rules after a canvas
  edit so the list and canvas agree.
- No migration. No change to `alarm_core`, the processor, or `usage.py`.
