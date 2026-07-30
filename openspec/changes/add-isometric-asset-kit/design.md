## Context

`add-spatial-scene-viewer` builds the scene engine on the 8 SVG device twins that
already exist in `web/src/components/DeviceTemplates/`. This change exists for the
case where that pilot shows the SVG twins do not carry a site scene convincingly — a
customer looks at it and sees a diagram rather than their site.

The art is deliberately separated from state. Layer 1 is neutral raster artwork,
layer 2 is the SVG overlay carrying every state and every motion, layer 3 is the
binding mapping device metrics to normalised overlay props. Layers 2 and 3 are built
by the scene change and are unaffected here. That separation is what lets a scene mix
SVG-template objects and raster objects, and what lets art be bought once while the
overlay stays themeable.

Production route is undecided and this specification is deliberately route-agnostic:
a 3D artist with a locked Blender rig, a purchased SCADA symbol library, and a
generative image model with a fixed reference anchor all satisfy or fail the same
acceptance criteria. Sourcing options examined include Equinor's open
`engineering-symbols`, `svg-control-schematics.com`, and commercial libraries whose
symbols export with logically named groups (which matters — named parts are what the
overlay binds to). Generative models are cheap per attempt but have no seed
parameter, which is an architectural property of the model, not a missing flag.

## Goals / Non-Goals

**Goals:**
- One binding specification agreed before anything is produced, because drift cannot
  be fixed retroactively.
- A raster object that is placement-, depth-, binding- and overlay-identical to an
  SVG template object, so a scene consumes either without a second code path.
- An acceptance gate cheap enough to run on every asset.

**Non-Goals:**
- Choosing a supplier or committing budget. That follows this spec.
- State variants, in any form.
- Replacing the SVG templates, or migrating existing scenes wholesale.
- Runtime shadow casting between objects — a materially harder system for a marginal
  gain over baked shadows.

## Decisions

**1. One object interface, two art sources.** A scene object resolves to either an
SVG template (metadata co-located in TypeScript) or a raster asset (metadata in a
JSON sidecar). Both expose footprint, anchor, sockets and overlay zones. The scene's
placement, depth ordering, binding and overlay code is written once against that
interface.
*Alternative considered:* a raster-only scene renderer with SVG templates retired.
Rejected — it discards 26 working files and forces the art purchase to be complete
before any vertical ships.

**2. Shadows baked into the asset, not cast at runtime.** Runtime shadows require
objects to shadow each other, which needs a light model, occlusion between arbitrary
footprints, and per-frame cost on wall displays. Baked shadows contained to the
footprint plus one tile of bleed give most of the depth cue for none of that.
*Trade-off:* an object placed unusually close behind another will not receive its
shadow. Accepted.

**3. Anchor at 50% width / 75% height, fixed across the kit.** This is the single
rule that makes placement work; every other output property could drift by a little
without breaking a scene, but a disagreeing anchor breaks every scene immediately.
*Alternative considered:* deriving the anchor per asset from the alpha bounding box.
Rejected — a tall thin asset and a wide flat one produce different implied ground
lines, and the error is invisible in isolation.

**4. Sidecar geometry is normative and hand-authored, not inferred.** Footprint drives
depth sorting; get it wrong and objects render through walls. Sockets and overlay
zones have no visual signature an algorithm could detect. The renderer reads; it
never guesses.

**5. Rejection over repair, with a logged reason.** Repairing an asset in post
reintroduces exactly the per-asset variation the locked rig exists to eliminate, and
does so invisibly. The rejection library doubles as the fastest onboarding for a
second contributor.

**6. Generative inputs are committed with their outputs.** Because there is no seed,
reference-image anchoring is the only reproducibility mechanism available and it is
partial. Committing the prompt and references makes an asset maintainable rather than
a one-off artefact.

**7. Kit scope fixed at 36 for the first pass** — 8 shared, 7 residential, 9
agriculture, 6 data centre, 6 water. Scoped now so the cost is a known number before
the gate is evaluated, not discovered during production.

## Risks / Trade-offs

- **Drift across a long production run** → locked rig, batch by material family
  (drift within a batch is materially lower than across sessions), and a side-by-side
  review of each batch against the first three assets rather than one asset at a time.
- **The first three assets set a style that turns out wrong at scene scale** → the
  first three are reviewed *inside the pilot scene*, not in isolation, before the
  remaining 33 are produced.
- **Transparent-background quality from generative models** → halos and soft edges
  that look wrong composited on a backdrop. Budget an alpha cleanup pass; treat edge
  quality as an acceptance criterion, not a nice-to-have.
- **Half-migrated scenes mixing SVG and raster objects look incoherent** → the
  interface permits mixing but the practice should not. Migrate a vertical completely
  or not at all.
- **Copyright** → purely model-generated images without meaningful human creative
  contribution may not be copyrightable; human editing and compositing improves the
  position but does not settle it. If the kit must be defensible IP, take advice
  before production.
- **Spending on art that the pilot proves unnecessary** → the entire reason this
  change is gated on `add-spatial-scene-viewer` task 7.4.

## Migration Plan

1. Gate check: read the pilot verdict. If the SVG twins passed, close this change
   unimplemented and record why.
2. Produce and accept three assets first; review them inside the pilot scene.
3. Add the raster object renderer to the scene layer; prove one raster object and one
   SVG-template object coexist correctly in the pilot scene.
4. Produce the remaining assets by vertical, shipping each vertical only when its
   objects are complete.
5. Rollback is scene-level: a scene referencing a raster object falls back to its SVG
   template resolution, so removing the kit does not break a saved scene.

## Open Questions

- **Production route** — artist with a Blender rig, purchased symbol library, or
  generative model with a reference anchor. Decide after the first three assets are
  attempted by the cheapest route and measured against this spec.
- **Tile size in pixels** — the kit's fixed orthographic scale needs a concrete
  reference tile size; derive it from the pilot scene's canvas dimensions rather than
  picking a round number first.
- **Whether agriculture and data centre belong in the first pass at all** — 15 of the
  36 assets serve verticals with no committed customer. Consider producing water and
  residential only, and treating the other two as a later kit.
