## Context

`add-visual-automation-canvas` built `web/src/components/flow/`:
`buildRuleGraph()` derives nodes/edges from a rule plus the tenant's
notification rules and channels; `RuleCanvas` renders them and owns the one
mutation the canvas has today (alarm→channel wiring). Nodes are
`deletable: false` and only the alarm→channel handle pair is connectable.

Relevant backend facts, verified rather than assumed:

| Fact | Location |
|---|---|
| `PUT` applies `metric`/`operator`/`threshold` only when the rule is THRESHOLD | `alert_rules_unified.py:333-339` |
| `PUT` applies `conditions`/`logic` only when the rule is COMPOSITE | `alert_rules_unified.py:342-347` |
| `AlertRuleUpdate` has no `rule_type` and no `device_id` | `alert_unified.py:75-91` |
| Rule selection is by device, not by rule type | `mqtt_processor.py:477-488` |
| `evaluate()` dispatches on normalized rule type | `engine.py:150-160` |
| `rule_type`/`severity` exist in both API and DB formats; `@validates` runs on assignment only | `unified_alert_rule.py:61-75` |

## Goals / Non-Goals

**Goals**
- Everything drawn on the canvas that represents a stored value is editable
  where it is drawn.
- One mutation path: the existing `PUT`, so the canvas and the forms cannot
  produce different rules.
- Conversion to COMPOSITE is explicit and preserves device scope.

**Non-Goals**
- Branching, multiple action paths, transform nodes. Still the
  `automation_nodes`/`automation_edges` change; still out of scope.
- Free-form node placement. Layout stays derived.
- Editing name, severity, description, cooldown on the canvas — those belong to
  the rule, not to a node, and the form does them well.
- COMPOSITE → THRESHOLD.
- Creating a rule from scratch on the canvas. "Create Rule" keeps opening the
  form; a blank canvas is a worse first-run experience than a form.

## Decisions

**1. A popover on the node, not a side panel or a modal.**
The canvas already uses the full width. A modal would cover the graph the user
is editing; a side panel would fight the rule picker. React Flow nodes are plain
DOM, so a popover anchored to the node is ordinary positioned markup — no new
dependency, and the rest of the graph stays visible for context.

**2. Save on explicit action, not on blur.**
Each save is a `PUT` of the whole `conditions` array. Auto-saving per keystroke
would issue a request per character and make a mis-typed threshold a persisted
value. The popover has Save/Cancel.

**3. The canvas owns no rule state.**
`RuleCanvas` derives its graph from the `rule` prop. After a successful `PUT` it
calls `onRuleChanged()` and the page refetches, exactly as `onWiringChanged()`
already works. No optimistic local copy of the rule to drift out of sync.

**4. Conversion is confirmed, and the confirmation says what it does.**
`+ Add condition` on a THRESHOLD rule prompts: this converts the rule to
COMPOSITE, its existing metric/operator/threshold becomes the first condition,
and the device it is scoped to does not change. Accept → one `PUT` carrying
`rule_type: 'COMPOSITE'`, `conditions: [existing, new]`, `logic: 'AND'`.

**5. The backend transition happens before the field updates, in one request.**
The router resolves the *incoming* rule type first, applies the transition, then
runs the existing per-type field logic against the new type. So a single `PUT`
that both converts and sets conditions works, rather than requiring the client
to make two calls with a half-converted rule in between.

The seed condition is built from the THRESHOLD columns server-side, not trusted
from the client — the client cannot see whether `operator` is stored in API
(`gt`) or DB (`>`) format, and `OPERATOR_DB_TO_API` already exists to resolve it.

**6. `metric` for a condition comes from the device type schema.**
The page already loads devices and device types and has
`getMetricsForDevice()`/`getSchemaForDevice()`. Those move to a module both the
page and the canvas import, rather than being duplicated or re-fetched.

## Risks / Trade-offs

- **Conversion is one-way.** Mitigated by asking first and by saying so in the
  prompt. A user who converts by mistake has to delete and recreate. Acceptable:
  the alternative is inventing a lossy COMPOSITE→THRESHOLD collapse.
- **`metric`/`operator`/`threshold` become vestigial after conversion.** They are
  left in place rather than nulled — the composite path ignores them, and
  keeping them means a converted rule still shows something sensible if anything
  reads the legacy columns. Noted in `CLEANUP_TODO.md`.
- **A rule edited on the canvas while the list page holds a stale copy.** Solved
  the same way wiring already is: refetch after the mutation.
- **The canvas now looks even more like a free-form editor.** Nodes are still not
  draggable and no new connection is creatable. The added affordances all map to
  a stored field.

## Migration Plan

None. No schema change, no data migration. `rule_type` on `AlertRuleUpdate` is
additive and optional, so existing clients — including the current form pages —
are unaffected.

## Open Questions

- Should `+ Add condition` be available when a THRESHOLD rule has no `metric`
  set at all (a malformed legacy row)? Assumed **no** for now: with nothing to
  seed the first condition from, conversion would produce a one-condition
  COMPOSITE rule that is strictly worse than fixing the rule in the form.
