## Why

Today a customer's site is a list of devices and a grid of widgets. Competitors
(Cumulocity, ThingsBoard) offer the same. The differentiator is a **scene**: a
picture of the customer's actual site — house, borehole, pump station, hall floor —
with real devices bound to objects in it, moving with live telemetry.

We are closer to this than the plan assumed. `web/src/components/DeviceTemplates/`
already contains 8 animated SVG device twins (tank, meter, pump, generator, solar,
HVAC, valve, motor) built on exactly the primitives a scene needs — `WaveLevel`,
`Spinner`, `ArcSweep`, `DashFlow`, `PulseRing`, `HeatGradient` — plus
`resolveNumeric` (normalise-once), `useSmoothed`, and a `StatusOverlay` state
grammar. That work is finished and **currently unreachable**: per
`openspec/specs/device-digital-twin-ui/spec.md`, `TemplateRenderer` is imported
only by the dev-only, unlinked `/dev/templates` route.

So the missing capability is not artwork. It is the layer above a single twin:
placing several of them on a backdrop, binding each to a real device, ordering them
correctly, and drawing the connections between them.

## What Changes

- **New `scenes` capability** — a versioned scene document (`"schema": 1`) holding a
  backdrop, a set of placed objects at normalised 0..1 canvas coordinates, per-object
  device+metric bindings, and hand-authored flow connections between object sockets.
- **Scene persistence** — tenant-scoped `scenes` table + CRUD endpoints under
  `/tenants/{id}/scenes`, following the existing router pattern (explicit
  `WHERE tenant_id`, tenant-mismatch 403, `set_tenant_context`).
- **Binding layer** — every bound reading passes through min/max config and reaches
  components as `0..1`, never engineering units. Reuses `resolveNumeric`.
- **Scene viewer** — fixed-aspect canvas, pan/zoom on mobile (never reflow),
  footprint-aware depth ordering, animation budget that degrades at high object
  counts, sunlight-readable contrast.
- **Stale/offline as a first-class state** — a scene object with no fresh reading
  renders visibly stale, never a confident stale value. Shape signal in addition to
  colour so fault is not colour-only.
- **List-view fallback** — every scene ships with an equivalent list of its bound
  devices, as the accessibility path, low-bandwidth path, and source of truth.
- **DeviceTemplates become scene objects** — templates gain footprint, anchor,
  socket and overlay-zone metadata so the scene can place them and attach flows;
  `TemplateRenderer` becomes reachable from the production page tree.
- **Pilot scene** — one hardcoded vertical (water site: reservoir, booster pump,
  flow meter, valve) driven by real telemetry, shown to one customer before any
  editor or art spend. This is the go/no-go gate for
  `add-isometric-asset-kit`.

**Non-goals for this change** (deliberately deferred, each is downstream of the
pilot answering "does this look sellable"):

- Raster isometric art kit — tracked separately in `add-isometric-asset-kit`,
  gated on this change's pilot.
- Scene builder UI (palette, drag, snap, save). Scenes are authored as JSON here.
- Flow auto-routing. Hand-authored paths are fine for the first ten customers.
- Grid engine with tile snapping and a separate editor environment.
- Browser clients subscribing directly to EMQX. The viewer polls/streams through the
  existing API; per-tenant broker ACLs are a separate security design task.

## Capabilities

### New Capabilities
- `spatial-scenes`: scene document schema and versioning, scene CRUD and tenant
  isolation, the value→0..1 binding layer, the viewer's placement/depth/animation
  budget rules, stale-state semantics, and the mandatory list-view fallback.

### Modified Capabilities
- `device-digital-twin-ui`: templates gain placement metadata (footprint, anchor,
  sockets, overlay zones) and `TemplateRenderer` becomes reachable from production
  routes rather than only the unlinked `/dev/templates` gallery — the current spec
  explicitly records that the system is unreachable outside dev.

## Impact

- **Frontend**: `web/src/components/DeviceTemplates/` (metadata additions, no
  rewrite of primitives), new `web/src/components/Scene/`, new viewer route under
  `web/src/app/dashboard/`.
- **Backend**: new `scenes` router, model, and Pydantic schemas; one Alembic
  migration in the same commit as the model.
- **Database**: `scenes` table, tenant-scoped, explicit `WHERE tenant_id` filtering
  (RLS is inert under the app's superuser connection — do not rely on it).
- **No new dependencies.** Overlay stays hand-written SVG in React. Rive is
  explicitly not adopted until the SVG overlay is proven insufficient (~200KB WASM).
- **Docs**: `docs/ART-STYLE-GUIDE.md` lands with `add-isometric-asset-kit`, not here.
