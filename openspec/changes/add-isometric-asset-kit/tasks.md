## 1. Gate

- [ ] 1.1 Read the customer verdict recorded by `add-spatial-scene-viewer` task 7.4
- [ ] 1.2 If the SVG twins were judged good enough at scene scale, close this change unimplemented with the verdict recorded, and stop
- [ ] 1.3 If not, write a one-paragraph brief naming exactly what the SVG twins failed to convey — that brief drives every art decision below

## 2. Rig and first three assets

- [ ] 2.1 Fix the kit's reference tile size in pixels, derived from the pilot scene's canvas dimensions
- [ ] 2.2 Build the camera and light rig for the chosen production route, and verify it with the 1×1×1m reference cube landing on exactly one tile footprint
- [ ] 2.3 Produce the first asset (the visually dominant object in the pilot vertical) and iterate until angle, light direction and material read correctly — this becomes the permanent style anchor
- [ ] 2.4 Produce two more assets from the same vertical against the anchor, in one batch
- [ ] 2.5 Review all three side by side on one neutral canvas, and again placed inside the pilot scene — not in isolation
- [ ] 2.6 If drift across three assets is already visible, stop and change production route before producing a fourth

## 3. Asset contract

- [ ] 3.1 Define the sidecar JSON schema (`id`, `footprint`, `height`, `anchor`, `sockets`, `overlayZones`) and a validator with a self-check for a missing sidecar, an out-of-range normalised coordinate, and a socket with no side
- [ ] 3.2 Author sidecars for the first three assets
- [ ] 3.3 Write the acceptance check that a proposed asset must pass before entering the repo: dimensions, alpha present, anchor at 50%/75%, transparent margin, palette conformance, no saturated pixels outside the palette range
- [ ] 3.4 Create the rejection library directory with its one-line-reason convention, and log every rejection from section 2

## 4. Raster objects in the scene layer

- [ ] 4.1 Implement the raster scene object renderer in `web/src/components/Scene/`, resolving placement from the sidecar
- [ ] 4.2 Draw the existing overlay primitives (`WaveLevel`, `Spinner`, `ArcSweep`, `DashFlow`, `PulseRing`) into the sidecar's declared overlay zones
- [ ] 4.3 Attach flow connections to sidecar sockets, using the same projection as SVG-template sockets
- [ ] 4.4 Confirm a raster object and an SVG-template object depth-sort correctly against each other in one scene
- [ ] 4.5 Implement fallback: a scene object whose raster asset is missing resolves to its SVG template instead of failing to render

## 5. Pilot vertical completion

- [ ] 5.1 Produce the remaining assets for the pilot vertical, batched by material family
- [ ] 5.2 Author sidecars for each and run the acceptance check on every one
- [ ] 5.3 Rebuild the pilot scene entirely from raster objects and compare it against the SVG version with a customer
- [ ] 5.4 Commit source prompts and reference images alongside any generated asset

## 6. Remaining verticals

- [ ] 6.1 Decide, on the evidence from section 5, whether agriculture and data centre belong in this kit at all or become a later one
- [ ] 6.2 Produce the shared set (ground tile, soil tile, concrete plinth, pipe straight, pipe corner, cable run, fence section, gate)
- [ ] 6.3 Produce each committed vertical's set as a batch, shipping a vertical only when its objects are complete
- [ ] 6.4 Run the acceptance check on every asset and log every rejection with its reason
