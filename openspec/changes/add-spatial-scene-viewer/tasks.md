## 1. Scene contract

- [ ] 1.1 Define the scene document TypeScript types in `web/src/components/Scene/types.ts`: `schema: 1`, `backdrop`, `aspect`, `objects[]` (id, template, x, y, footprint override, bindings), `connections[]` (from/to socket refs, grid-space waypoints, flow binding)
- [ ] 1.2 Mirror the document as Pydantic schemas in `api/app/schemas/scene.py`, validating `x`/`y` within `0..1` and rejecting unknown `schema` versions
- [ ] 1.3 Write a scene-document validator with a self-check asserting: out-of-range coordinates rejected, unknown schema version rejected, connection referencing a missing socket flagged

## 2. Persistence

- [ ] 2.1 Add the `scenes` SQLAlchemy model (tenant-scoped, JSONB document column, name, created/updated) in `api/app/models/`
- [ ] 2.2 Write the Alembic migration for `scenes` in the same commit as the model
- [ ] 2.3 Add `api/app/routers/scenes.py` with list/create/get/update/delete under `/tenants/{tenant_id}/scenes`, following the existing router pattern: path-vs-token tenant check → 403, `set_tenant_context`, explicit `WHERE tenant_id` on every query
- [ ] 2.4 Register the router and add tests covering: cross-tenant path → 403, other tenant's scene id under own path → 404, coordinate out of range → 422

## 3. Template placement metadata

- [ ] 3.1 Extend `DeviceTemplates/types.ts` with a `PlacementDescriptor` (footprint `w`/`d`, anchor, named sockets, overlay zones)
- [ ] 3.2 Declare placement descriptors for all 8 templates (water tank, water meter, pump, generator, solar, HVAC, valve, motor), exported from `DeviceTemplates/index.ts`
- [ ] 3.3 Verify `/dev/templates` still renders all 8 unchanged — placement metadata is additive and must not alter existing rendering

## 4. Binding layer

- [ ] 4.1 Implement scene binding resolution: device + metric + min/max → clamped `0..1`, reusing `primitives/resolveNumeric.ts` rather than a new normaliser
- [ ] 4.2 Implement state classification into `running | idle | fault | stale | offline`, with `stale` driven by the binding's freshness window and carrying a last-seen timestamp
- [ ] 4.3 Implement the clamped motion mapper: normalised value → animation rate between declared min/max bounds, never a raw reading
- [ ] 4.4 Add one test file asserting: 3500/5000 → 0.7, 6200/5000 → 1.0, no fresh reading → `stale` with motion stopped, never-reported → `offline`

## 5. Scene rendering

- [ ] 5.1 Build the fixed-aspect scene canvas with normalised coordinate projection in `web/src/components/Scene/SceneCanvas.tsx`
- [ ] 5.2 Implement footprint-bounds depth ordering (not `x + y`), with a test covering a 3×2 object overlapping a 1×1 object
- [ ] 5.3 Place resolved `TemplateRenderer` output as scene objects, anchored via each template's placement descriptor
- [ ] 5.4 Render flow connections from grid-space waypoints projected at draw time, animated by the clamped flow binding; omit and warn on unknown socket references
- [ ] 5.5 Implement the concurrent-animation budget: above the declared object count, suppress wave/flow/particle motion while preserving static state indication

## 6. Viewer surface

- [ ] 6.1 Add the scene viewer route under `web/src/app/dashboard/`, loading a scene by id from the API
- [ ] 6.2 Implement pan and pinch-zoom for viewports narrower than the canvas — no reflow, no restacking
- [ ] 6.3 Apply the shared state grammar: identical indicator position and wording across device types, with a non-colour shape signal on fault
- [ ] 6.4 Build the list-view fallback of the same bound devices (value, unit, state, last seen), keyboard and screen-reader navigable, reachable from the scene
- [ ] 6.5 Verify contrast and indicator size against sunlight readability on a phone

## 7. Pilot and gate

- [ ] 7.1 Author one water-site scene JSON: reservoir, booster pump, flow meter, control valve, with connections between them
- [ ] 7.2 Bind it to real devices and confirm live values move the scene end to end
- [ ] 7.3 Force each state deliberately — running, idle, fault, stale, offline — and confirm the scene reads correctly for each, especially stale
- [ ] 7.4 Show it to one customer and record the verdict on whether the existing SVG twins are good enough at scene scale
- [ ] 7.5 Based on 7.4, either close `add-isometric-asset-kit` as unnecessary or unblock it with a concrete brief on what the SVG twins failed to convey
