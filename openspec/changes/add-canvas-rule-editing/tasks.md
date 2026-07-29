## 1. Backend: allow the THRESHOLD → COMPOSITE transition

- [x] 1.1 `api/app/schemas/alert_unified.py` — add optional `rule_type` to
      `AlertRuleUpdate`. Additive and optional, so the existing form pages are
      unaffected.
- [x] 1.2 `api/app/routers/alert_rules_unified.py` — in `update_alert_rule`,
      resolve the *incoming* rule type before the per-type field blocks. On a
      THRESHOLD → COMPOSITE transition: seed the first condition from the stored
      `metric`/`operator`/`threshold` (resolving the operator via
      `OPERATOR_DB_TO_API`, not from the client), set `rule_type`, and let the
      existing COMPOSITE block apply `conditions`/`logic` in the same request.
      Leave `device_id` untouched.
- [x] 1.3 Refuse COMPOSITE → THRESHOLD with a 400 rather than silently ignoring
      it, so a client that tries gets told why.
- [x] 1.4 Refuse an empty `conditions` array on a COMPOSITE rule with a 400 — a
      rule that can never fire is not a valid rule.
- [x] 1.5 Self-check: a THRESHOLD rule + `{rule_type: COMPOSITE, conditions:[…],
      logic:'AND'}` in one PUT comes back COMPOSITE with the seeded first
      condition and its original `device_id`; a COMPOSITE → THRESHOLD PUT 400s;
      an empty-conditions PUT 400s.

## 2. Frontend: edit condition values in place

- [x] 2.1 Move `getSchemaForDevice`/`getMetricsForDevice` out of
      `alert-rules/page.tsx` into a shared module both the page and the canvas
      import — the canvas needs the same metric list, and duplicating it would
      let the two drift.
- [x] 2.2 `ConditionEditor` popover anchored to a condition node: metric (from
      the device type schema), operator, threshold, and weight for COMPOSITE.
      Save/Cancel — no save on blur or per keystroke.
- [x] 2.3 Wire save to the existing `PUT`. THRESHOLD rules send
      `metric`/`operator`/`threshold`; COMPOSITE rules send the whole rebuilt
      `conditions` array.
- [x] 2.4 On success call `onRuleChanged()`; the page refetches rules so the
      list and canvas agree. The canvas keeps no local rule copy.
- [x] 2.5 Clicking the alarm node still opens the existing rule form (name,
      severity, description, cooldown) — those are not duplicated on the canvas.

## 3. Frontend: logic toggle, add and remove conditions

- [x] 3.1 Clicking the logic node flips `AND` ↔ `OR` via the same `PUT`.
- [x] 3.2 `+ Add condition` node at the end of the condition column. On a
      COMPOSITE rule it appends a condition and opens its editor.
- [x] 3.3 Remove affordance on a condition node; removing the last condition of a
      COMPOSITE rule is refused with a toast rather than sending a doomed request.
- [x] 3.4 On a THRESHOLD rule, `+ Add condition` asks for confirmation naming the
      conversion — becomes COMPOSITE, existing threshold becomes the first
      condition, device scope unchanged — then sends the single converting `PUT`.
- [x] 3.5 Hide `+ Add condition` on a THRESHOLD rule with no `metric` set; there
      is nothing to seed the first condition from (see design.md open question).
- [x] 3.6 Self-check for the graph builder: a rule with the add-affordance
      enabled emits the `+` node; a single-condition COMPOSITE rule's condition
      node reports that removal is not allowed.

## 4. Verification

- [x] 4.1 `npm run build` and `npx jest` in `web/` — clean.
- [x] 4.2 `pytest` for the touched API router — clean.
- [x] 4.3 Playwright: edit a condition's threshold on the canvas, reload, confirm
      the new value persisted.
- [x] 4.4 Playwright: flip a COMPOSITE rule's AND→OR, reload, confirm persisted.
- [x] 4.5 Playwright: add a condition to a THRESHOLD rule, confirm the prompt,
      and verify the rule is COMPOSITE with two conditions, a logic node, and the
      **same `device_id`** as before.
- [x] 4.6 Confirm a converted rule still fires: replay telemetry through the
      existing alert-rule preview endpoint (which runs `alarm_core`) and check it
      evaluates by the composite path.
- [x] 4.7 Confirm no migration was added.

## 5. Documentation

- [x] 5.1 `CLAUDE.md` — the canvas now edits conditions/logic in place; the forms
      own name/severity/description/cooldown. Note that THRESHOLD → COMPOSITE is
      one-way.
- [x] 5.2 `CLEANUP_TODO.md` — record that a converted rule keeps vestigial
      `metric`/`operator`/`threshold` columns, and that branching still means the
      `automation_nodes`/`automation_edges` model, not more canvas patches.
