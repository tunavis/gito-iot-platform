## Context

The originating plan proposed a three-layer architecture — pre-rendered isometric
raster art (neutral state only), an SVG overlay carrying all state and motion, and a
binding layer mapping device metrics to normalised overlay props — with the art kit
sequenced first as the long pole and biggest cash cost.

Auditing the repo before accepting that sequencing changes the picture.
`web/src/components/DeviceTemplates/` already ships:

| Plan calls it | Already exists |
|---|---|
| `Vessel` (tank fill) | `primitives/WaveLevel.tsx` |
| `Rotor` | `primitives/Spinner.tsx` |
| `Dial` | `primitives/ArcSweep.tsx` |
| `Conduit` / `Flow` | `primitives/DashFlow.tsx` |
| status ring | `primitives/PulseRing.tsx`, `Blink.tsx` |
| heat tint | `primitives/HeatGradient.tsx` |
| "normalise once" | `primitives/resolveNumeric.ts` |
| motion smoothing | `primitives/useSmoothed.ts` |
| state grammar | `overlays/StatusOverlay.tsx` |
| named-part binding | `resolveTemplate.ts` + `TemplateRenderer.tsx` |
| device art | 8 templates: tank, meter, pump, generator, solar, HVAC, valve, motor |

`openspec/specs/device-digital-twin-ui/spec.md` records that this entire system is
currently unreachable outside the unlinked `/dev/templates` route. The two `.jsx`
mockups supplied with the plan (`DeviceSystem.jsx`, `SceneSystem.jsx`) re-implement
the primitives above from scratch; they are useful as *layout* references for the
scene composition and the vertical backdrops, and should not be merged as code.

Constraints carried in from the platform: the app's DB role bypasses RLS, so tenant
isolation is explicit `WHERE tenant_id` (see `openspec/specs/multi-tenancy-and-orgs`
and prior audit findings). Backend returns data directly, not wrapped in `{data:…}`.
Model changes ship with an Alembic migration in the same commit.

## Goals / Non-Goals

**Goals:**
- A versioned scene document that survives format change (`"schema": 1` from commit
  one) and a binding contract that other work can depend on.
- Reuse the existing twin templates as the scene's placeable objects — no second
  rendering stack, no per-device-type component.
- One pilot scene on real telemetry, in front of one customer, before any spend on
  art or an editor. This is the go/no-go gate.
- Stale-state and list-view correctness treated as requirements, not polish.

**Non-Goals:**
- The raster isometric art kit (`add-isometric-asset-kit`), gated on the pilot.
- Scene builder UI, flow auto-routing, grid snapping, a separate editor environment.
- Browser clients subscribing directly to EMQX.
- Rive / Lottie. Not until the SVG overlay is demonstrably insufficient.

## Decisions

**1. SVG-first objects, raster art deferred — invert the plan's "art first" order.**
The plan sequenced art first because art was assumed to be the long pole and the
variable deciding whether the product looks sellable. That reasoning holds for a kit
that does not exist; here 8 device twins already exist and have never been shown to a
customer. Building the scene on them tests the same hypothesis — "does live data
moving on a site picture feel like a product" — at zero art cost and in days rather
than weeks. If the SVG twins look good enough in a scene, the 36-asset kit may never
need to be bought. If they don't, the pilot says so cheaply and
`add-isometric-asset-kit` proceeds with a clear brief.
*Alternative considered:* generate the kit with an image model first (the plan's
"R5 test"). Rejected as the first step because it answers a narrower question — asset
style consistency — while leaving the product question untested, and because image
models have no seed parameter, so regenerating a single asset consistently later is
not reliable. It stays the right first step *for the art kit change*, once that change
is unblocked.

**2. Scene document is JSON in a `scenes` table, not a filesystem format.**
Scenes are customer data and must be tenant-isolated, versioned and backed up like
dashboards. Follows the existing `dashboards` / `dashboard_widgets` precedent — but
tenant-scoped rather than user-scoped, because a site scene describes shared
infrastructure, not one person's dashboard.
*Alternative considered:* store scenes inside `dashboard_widgets.configuration` as a
widget type. Rejected: a scene's object list and connection graph would outgrow a
widget config blob, and scene-level CRUD/validation would have nowhere to live.

**3. Placement metadata lives beside the templates, in TypeScript, not in the DB.**
`footprint`, `anchor` and `sockets` are properties of the artwork, identical for every
tenant. They ship with the template module and are versioned with the code. The scene
document stores only the *reference* to a template plus its placement and bindings.
*Alternative considered:* the plan's JSON sidecar per asset. That is correct for
purchased raster art (the renderer genuinely cannot infer it from a PNG) and belongs
in `add-isometric-asset-kit`. For in-repo SVG components a co-located TS export is
the same information with type checking and no build step.

**4. Depth ordering by footprint bounds, not `x + y`.**
Recorded explicitly because `x + y` is the intuitive wrong answer and fails late: it
is only correct for 1×1 footprints, and a multi-tile object sorts incorrectly against
its neighbours, rendering a tank in front of a wall it sits behind. Painter's ordering
over footprint bounds, with pairwise occlusion as the fallback for genuinely
ambiguous pairs.

**5. Connection paths are authored in grid space and projected, never routed in
screen space.** Screen-horizontal and screen-vertical are diagonals on an isometric
grid, so a screen-space Manhattan path visually floats above the ground plane.
Authored paths are stored as grid-space waypoints and projected at render time. This
also means auto-routing, when it arrives, operates on grid coordinates.

**6. Telemetry reaches the viewer through the existing API, not a direct broker
subscription.** Per-tenant EMQX ACLs, topic-level authorisation, JWT refresh and
reconnect-with-backfill are a security design task, not a hook. The viewer uses the
same telemetry path the dashboard widgets already use; the broker question is
revisited only if polling latency proves to be the limiting factor.

**7. One vertical for the pilot: a water site.** The platform's strongest existing
templates (tank, pump, valve, flow meter) are exactly the water set, and the
customer-facing use case is concrete. Residential/solar was the plan's pilot, but it
needs house and inverter artwork that does not exist and would force decision 1 back
to art-first.

## Risks / Trade-offs

- **The SVG twins look flat or toy-like at scene scale, unlike the isometric
  reference product** → this is precisely what the pilot measures. Failure here is a
  cheap, early "yes, buy the art kit" answer, not wasted work: the scene schema,
  binding layer, depth ordering and viewer all survive an art swap, because art
  never encodes state.
- **Mixing SVG twins now with raster art later produces a visually incoherent scene**
  → the object interface (footprint / anchor / sockets / overlay zones) is identical
  for both, so a scene can be migrated one object at a time; but a *half-migrated*
  scene will look wrong. Migration, if it happens, is per-vertical and complete.
- **Animation cost on wall displays running 24/7 on weak hardware** → declared
  animation budget with automatic degradation, specified as a requirement rather
  than discovered in production.
- **Stale readings rendered confidently** → the highest-consequence failure in the
  whole feature; a tank showing 72% from three days ago. Specified as a first-class
  state with a mandatory last-seen timestamp, and designed before the running state.
- **Scene format churn as customers author scenes** → `schema` version present from
  the first row, and the viewer refuses unknown versions rather than degrading.
- **Scope creep into the builder** → scenes are authored as JSON in this change.
  Editor work is not started until the pilot has been shown to a customer.

## Migration Plan

1. Model + Alembic migration for `scenes` in one commit; no existing data to migrate.
2. Placement metadata added to the 8 templates — additive, does not change existing
   rendering, `/dev/templates` continues to pass visual QA.
3. Scene viewer route ships behind the existing navigation without a scene seeded;
   the pilot scene is inserted as tenant data, not as a migration.
4. Rollback is dropping the route and the table; nothing else depends on it.

## Open Questions

- **Scene templates vs blank canvas** — recommend shipping curated starting scenes
  per vertical. A blank canvas produces bad scenes and support tickets. Decide before
  the builder change, not this one.
- **Custom backdrop upload** — escape hatch only, never the primary path; blurry
  phone photos of pump houses become a support burden. Not in this change.
- **Freshness window default** — per-binding config is specified; the sensible
  platform default likely derives from the device's reporting interval rather than a
  fixed constant. Resolve during implementation against real device data.
