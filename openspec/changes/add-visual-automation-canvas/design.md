## Context

Two existing pages render graph-shaped data without a graph library:

| Surface | File | Today |
|---|---|---|
| Hierarchy | `web/src/app/dashboard/hierarchy/page.tsx` (483 lines) | Hand-rolled recursive expand/collapse list; `OrgNode → SiteNode[] → (SiteNode.children, DeviceGroupNode[])`; ~43 drag/node/svg-adjacent occurrences |
| Alert rules | `web/src/app/dashboard/alert-rules/page.tsx` (1176 lines) | Forms only; the rule→channel relationship is on a *different page* (`/dashboard/notification-rules`) |

The alert-rule data model (`api/app/models/unified_alert_rule.py`) is flat:

- `rule_type` `THRESHOLD` — one `device_id` + `metric` + `operator` + `threshold`
- `rule_type` `COMPOSITE` — `conditions: [{field, operator, threshold, weight}]`
  + `logic: AND|OR`

`notification_rules(alert_rule_id, channel_id, enabled)` is a plain join table —
a set of edges from one rule to N channels.

Note the format hazard documented at `unified_alert_rule.py:61-75`: `rule_type`,
`severity`, and `operator` exist in the DB in *both* API and legacy DB formats,
and the `@validates` hooks only convert on Python-side assignment, not on load.
Anything this change reads must go through `to_response_dict()` /
`normalize_rule_type()` rather than comparing raw column values.

## Goals / Non-Goals

**Goals**
- One graph library for the whole repo, wrapped once so surfaces don't each
  re-theme it.
- The alert-rule trigger→action path is visible and its channel wiring editable
  in one place.
- Hierarchy gets pan/zoom/minimap and loses its bespoke tree code.
- Zero backend change; zero migration.

**Non-Goals**
- A rule engine, branching, or free-form node placement (see the ceiling in
  `proposal.md`).
- Replacing `react-grid-layout` in the dashboard builder. That is a *layout* grid,
  not a node graph; it stays on 1.4.4 per `CLEANUP_TODO.md`.
- Touching `DeviceTemplates/` or `visualization/`. Those are SVG artwork
  (`FlowLine.tsx`, `DashFlow.tsx`, pump/valve/tank templates) driven by live
  telemetry — React Flow is the wrong tool and would be a regression.
- Persisting node positions.

## Decisions

**1. `@xyflow/react` v12, not `reactflow` v11.**
`reactflow` is the v11 package name; the current library at reactflow.dev is
`@xyflow/react`. 12.11.2, MIT, peer `react >=17` — clean against React 18.2 /
Next 14. Imports are `import { ReactFlow } from '@xyflow/react'` plus
`import '@xyflow/react/dist/style.css'`.

**2. Wrap it once, in `web/src/components/flow/`.**
Pages import `<FlowCanvas>`, never `<ReactFlow>` directly. This is the only
concession to abstraction in this change and it earns itself immediately: two
call sites need the same theme tokens, the same `fitView` behaviour, the same
minimap/controls config, and the same `'use client'` boundary. Node components
live under `flow/nodes/` and are registered in one `nodeTypes` map.

**3. Layout is computed, not stored — and it is ~30 lines, not a dependency.**
Both graphs are strict trees of known, shallow depth (hierarchy: org→site→group,
plus nested `SiteNode.children`; rule: conditions→logic→alarm→channels). A
`useTreeLayout` helper assigning `x = depth * COL_W`, `y = leafIndex * ROW_H`
handles both. **No `dagre`, no `elkjs`.** Add one only if a real DAG with
crossing edges ever exists — it does not today, and pulling a layout engine in
for a tree is exactly the kind of thing that never gets removed.

**4. The alert-rule graph is derived, per rule, at render time.**
Given the rule response plus the tenant's `notification_rules` and
`notification_channels`, build:

- THRESHOLD → one `ConditionNode` (`{device} {metric} {op} {threshold}`)
- COMPOSITE → one `ConditionNode` per entry in `conditions[]`
- one `LogicNode` (`AND`/`OR`) only when there is more than one condition —
  a single-condition rule wires straight to the alarm, because a one-input
  AND gate is noise
- one `AlarmNode` (name, severity, cooldown, `last_triggered_at`)
- one `ChannelNode` per notification channel in the tenant; channels wired to
  this rule are connected by an edge and rendered active, unwired ones are
  rendered dimmed so the drag target is discoverable

**5. Editing: drag an edge = create a notification rule.**
`onConnect` from an `AlarmNode` to a `ChannelNode` → `POST` a notification rule.
Deleting that edge → `DELETE` it. Both are existing endpoints. Every other node
opens the existing form for that entity — this change does not reimplement
threshold/condition editing inside the canvas.

**6. Hierarchy keeps its data fetch and its sidebar.**
Only the rendering swaps. `healthColor`, `HealthDot`, `AlarmBadge`, the
`SelectedNode` union, and the detail panel are reused verbatim; node selection
sets `SelectedNode` exactly as the tree's click handler does today. Search
filters the node set rather than the tree.

**7. SSR.** All three surfaces are already `'use client'`. React Flow measures the
DOM, so `<FlowCanvas>` renders nothing until mounted and its container has an
explicit height — a zero-height parent is the standard way this library silently
renders blank.

## Risks / Trade-offs

- **Bundle size.** `@xyflow/react` is ~50KB gzipped. Acceptable for two
  authenticated dashboard routes; both are dynamically imported so it stays out
  of the shared chunk and off the marketing/pricing pages.
- **The canvas may over-promise.** A node graph *looks* like a free-form editor,
  and users will try to drag nodes and add branches. Mitigation: nodes are not
  draggable (`nodesDraggable={false}`) and the only connectable handles are
  alarm→channel. An affordance that does nothing is worse than no affordance.
- **Hierarchy at scale.** A tenant with hundreds of sites produces a very tall
  canvas. The tree today has the same problem (a very long scroll); the canvas at
  least gets `fitView` and a minimap. If it becomes real, collapse-by-default at
  the site level is the fix, not virtualization.
- **Two ways to wire a channel.** The canvas and `/dashboard/notification-rules`
  both create notification rules. Kept intentionally — the list page handles bulk
  work the canvas is bad at. Both hit the same endpoint, so they cannot diverge.

## Migration Plan

None. No schema change, no data backfill, no API version bump. The hierarchy tree
is replaced in a single commit (its state is ephemeral UI state — expanded/collapsed
sets, not persisted). The alert-rule canvas is added *alongside* the existing list
view behind a view toggle, so the forms remain reachable if the canvas has a
problem in production.

## Open Questions

- Should the alert-rule canvas show *all* the tenant's rules at once (a fleet-wide
  automation map) or one rule at a time? This change assumes **one rule at a time**,
  selected from the existing list. A fleet-wide map is a better demo and a worse
  tool; revisit after the single-rule view is real.
- Does the hierarchy canvas want device-level leaf nodes? Today the tree stops at
  device *groups* and shows counts. Keeping that — a 67-device tenant would draw
  67 leaf nodes per group with nothing useful on them.
