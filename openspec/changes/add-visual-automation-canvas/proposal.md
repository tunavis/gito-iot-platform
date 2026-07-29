## Why

The platform sells "Automation rules" as a metered plan limit (`automations.max`
in `024_billing_core.py`, on the pricing page and the billing page) and every
competitor — ThingsBoard rule chains, Cumulocity streaming analytics, n8n — ships
that as a canvas. Gito ships it as three unconnected form pages, and `usage.py`
quietly counts `SELECT count(*) FROM alert_rules` to bill for it.

The graph is not missing. It is already in the database and has been for a while:

```
device/metric ──┐
device/metric ──┼─→ alert_rules.conditions ─→ .logic (AND|OR) ─→ alarm
device/metric ──┘                                                  │
                                        notification_rules(alert_rule_id, channel_id)
                                                                   ↓
                                                      notification_channels (email/SMS/webhook)
```

A tenant who wants to answer "what actually happens when tank 3 goes low?" has to
open `/dashboard/alert-rules`, read a 1176-line page's worth of forms, then open
`/dashboard/notification-rules`, then cross-reference `/dashboard/notifications`
for the channel. The relationship is real, stored, and queryable — it is just
never *drawn*.

Meanwhile `/dashboard/hierarchy` hand-rolls a 483-line expand/collapse tree with
its own selection state, and the org→site→group→device structure it renders is
also a graph.

So: one graph library, two surfaces that already have graph-shaped data, no new
engine. React Flow (`@xyflow/react` 12.11.2, MIT, React ≥17 — compatible with this
repo's React 18.2 / Next 14) is the standard choice and does pan/zoom, edge
routing, minimap, and drag-to-connect that we would otherwise write badly.

## What Changes

- New dependency `@xyflow/react` — **the only** node-graph library the repo may
  use. Any future graph, diagram, or node-editor surface uses it rather than
  hand-rolled SVG. (This does *not* cover the device digital-twin templates in
  `web/src/components/DeviceTemplates/` and `web/src/components/visualization/` —
  those are illustrative artwork with animated flow effects, not node graphs, and
  are explicitly out of scope.)
- New shared `web/src/components/flow/` module: a thin wrapper (`<FlowCanvas>`)
  that applies the Gito theme, a `useTreeLayout` helper that computes deterministic
  node positions for a tree, and the shared node components. Both surfaces below
  consume it — neither imports `@xyflow/react` directly for layout or chrome.
- `/dashboard/alert-rules` gains a **canvas view** of the selected rule showing
  its full automation graph — condition nodes → logic node → alarm node →
  channel nodes — with the existing forms retained for editing node internals.
  Wiring a channel to a rule is done by dragging an edge, which calls the existing
  `notification_rules` create/delete endpoints. **No schema change**: node
  positions are *derived* from the rule, not stored.
- `/dashboard/hierarchy` replaces its hand-rolled tree with the same canvas —
  pan, zoom, minimap, health colouring preserved. The existing detail sidebar
  (`SelectedNode`) is unchanged and still driven by node selection.
- **No new tables, no new backend endpoints, no rule-engine change.** Every read
  and write in this change goes through endpoints that already exist. `alarm_core`
  evaluation is untouched.

### Deliberate ceiling

A derived layout means the alert-rule canvas is a **view and a wiring editor**,
not a free-form designer: users cannot drag nodes to arbitrary positions (there
is nowhere to persist that) and cannot express branching beyond the single
AND/OR that `alert_rules.logic` supports. Multi-branch chains (if/else, several
independent action paths, transform/enrich nodes) need a real `automation_nodes`
/ `automation_edges` model plus an executor — that is a separate, much larger
change, and this one is deliberately not it. This change buys the shared canvas
foundation and makes the shipped feature look like the thing being billed for;
it does not build a rule engine.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `alarms-and-alerting`: adds a requirement that a rule's trigger→action path is
  presented as one navigable graph, and that channel wiring is editable from it.
  The evaluation semantics of threshold/composite rules are unchanged.
- `multi-tenancy-and-orgs`: the org/site/group hierarchy gains a requirement to
  render as a pannable, zoomable graph rather than a nested list.

## Impact

- `web/package.json` — add `@xyflow/react` (^12.11.2).
- `web/src/components/flow/` — new: `FlowCanvas.tsx`, `useTreeLayout.ts`,
  `nodes/` (HierarchyNode, ConditionNode, LogicNode, AlarmNode, ChannelNode),
  `index.ts`.
- `web/src/app/dashboard/alert-rules/page.tsx` — canvas view added alongside the
  existing list/form; graph derived from `UnifiedAlertRule.to_response_dict()`
  plus the tenant's notification rules and channels.
- `web/src/app/dashboard/hierarchy/page.tsx` — ~200 lines of tree/expand/collapse
  rendering deleted and replaced by `<FlowCanvas>`; `healthColor`, `HealthDot`,
  `AlarmBadge`, and the detail sidebar are reused as-is.
- `web/src/app/globals.css` — React Flow stylesheet import and dark-theme
  variable overrides.
- No `api/` changes. No migration. No change to `alarm_core`, `usage.py`, or the
  `automations.max` meter (which continues to count `alert_rules` rows).
