## 1. Dependency and shared canvas

- [x] 1.1 `npm i @xyflow/react@^12.11.2` in `web/`. Confirm the lockfile resolves
      against React 18.2 without a peer warning.
- [x] 1.2 Import `@xyflow/react/dist/style.css` in `web/src/app/globals.css` and
      add the dark-theme variable overrides (`--xy-node-background-color`,
      `--xy-edge-stroke`, `--xy-controls-button-background-color`, …) so the
      canvas matches the existing dashboard palette rather than shipping the
      library's default light chrome.
- [x] 1.3 `web/src/components/flow/FlowCanvas.tsx` — `'use client'` wrapper over
      `<ReactFlow>`: applies `nodeTypes`, `fitView`, `nodesDraggable={false}`,
      `<Background>`, `<Controls>`, `<MiniMap>`. Renders `null` until mounted and
      requires an explicit-height container (documented in a comment — a
      zero-height parent renders blank with no error).
- [x] 1.4 `web/src/components/flow/useTreeLayout.ts` — deterministic tree layout:
      `x = depth * COL_W`, `y` from a running leaf counter, parents centred over
      their children. ~30 lines, no `dagre`/`elkjs`.
- [x] 1.5 `web/src/components/flow/index.ts` — barrel export, matching the
      convention in `web/src/components/visualization/index.ts`.
- [x] 1.6 Self-check for the layout helper: assert a known 3-level fixture yields
      non-overlapping `y` values, correct depth-based `x`, and parents centred.

## 2. Hierarchy canvas

- [x] 2.1 `web/src/components/flow/nodes/HierarchyNode.tsx` — org / site / group
      variants. Reuses `healthColor`, `HealthDot`, `AlarmBadge` from the existing
      page (lift them to a shared module rather than copying).
- [x] 2.2 Flatten `OrgNode → SiteNode[] → (children, device_groups)` into
      `nodes`/`edges`, including the recursive `SiteNode.children` nesting.
- [x] 2.3 Replace the tree render in `hierarchy/page.tsx` with `<FlowCanvas>`.
      Delete the expand/collapse state and recursive row components; keep the
      data fetch, the `SelectedNode` union, and the detail sidebar untouched.
- [x] 2.4 Node click sets `SelectedNode` exactly as the tree row click does today,
      so the sidebar needs no change.
- [x] 2.5 Wire the existing search box to filter the node set (and the edges that
      reference dropped nodes) instead of filtering tree rows.
- [x] 2.6 Dynamic-import the canvas (`next/dynamic`, `ssr: false`) so
      `@xyflow/react` stays out of the shared chunk.

## 3. Alert-rule automation canvas

- [x] 3.1 Node components: `ConditionNode`, `LogicNode`, `AlarmNode`,
      `ChannelNode` under `web/src/components/flow/nodes/`.
- [x] 3.2 `buildRuleGraph(rule, notificationRules, channels)` — pure function,
      no React. THRESHOLD → one condition node; COMPOSITE → one per
      `conditions[]` entry. Emit the `LogicNode` **only** when there is more than
      one condition. Read `rule_type`/`severity`/`operator` from the API-format
      response, never from raw column values (see `unified_alert_rule.py:61-75`).
- [x] 3.3 Render every tenant channel as a `ChannelNode`; wired ones get an edge
      and active styling, unwired ones render dimmed so the drop target is
      discoverable.
- [x] 3.4 `onConnect` (alarm → channel) posts a notification rule via the existing
      endpoint; edge delete removes it. Only that one handle pair is connectable.
- [x] 3.5 Clicking any other node opens the existing edit form for that entity —
      no threshold/condition editing is reimplemented inside the canvas.
- [x] 3.6 Add the list/canvas view toggle to `alert-rules/page.tsx`, defaulting to
      the existing list. The forms stay reachable.
- [x] 3.7 Self-check for `buildRuleGraph`: assert a single-condition THRESHOLD
      rule produces no logic node, a 3-condition COMPOSITE produces one logic node
      with 3 inbound edges, and a rule with zero wired channels still renders all
      channels as unwired.

## 4. Verification

- [x] 4.1 `npm run build` in `web/` — clean, no new type errors.
- [x] 4.2 Playwright pass with the `claude-playwright@gito.demo` account: hierarchy
      canvas renders with real org/site/group data, pans and zooms, node click
      opens the correct sidebar entry, search narrows the graph.
- [x] 4.3 Playwright: open a COMPOSITE rule's canvas, drag alarm → an unwired
      channel, reload, confirm the edge persisted (i.e. the notification rule was
      actually created, not just drawn).
- [x] 4.4 Confirm no `api/` file changed and no migration was added — this change
      is frontend-only by construction.

## 5. Documentation

- [x] 5.1 `CLAUDE.md` — record `@xyflow/react` as the repo's one node-graph
      library, and that `DeviceTemplates/` + `visualization/` are deliberately
      excluded from it.
- [x] 5.2 `CLEANUP_TODO.md` — log the deliberate ceiling (derived layout, no
      branching) and the upgrade trigger: the first customer request for
      multi-branch automations means the `automation_nodes`/`automation_edges`
      model, not another patch on this canvas.
