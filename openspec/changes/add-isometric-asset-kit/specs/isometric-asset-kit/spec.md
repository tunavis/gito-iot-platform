## ADDED Requirements

### Requirement: Every kit asset is rendered from one locked isometric camera
The system SHALL accept kit assets rendered only under true isometric orthographic
projection: 45° rotation around the vertical axis, 30° tilt from horizontal (2:1
screen ratio), 0° roll, and a fixed orthographic scale shared by the whole kit.
Perspective projection SHALL be rejected. The scale SHALL NOT be adjusted per asset
to fit the frame.

#### Scenario: The camera rig is verified
- **WHEN** a 1×1×1 metre reference cube is rendered through the rig
- **THEN** it occupies exactly one tile footprint at the kit's standard tile size,
  which is the check that the rig has not moved between assets

#### Scenario: An asset arrives with a different angle
- **WHEN** a delivered asset's projection differs from the locked rig by any amount
- **THEN** it is rejected and regenerated, not corrected in post

#### Scenario: A large asset was zoomed to fit its frame
- **WHEN** an asset was rendered at a different orthographic scale so it filled the
  1024px frame
- **THEN** it is rejected, because it will not sit at the same scale as its
  neighbours in a scene

### Requirement: Every kit asset uses one locked light rig with baked shadows
The system SHALL accept kit assets lit by a single key light from the top-left at 60°
elevation and 45° azimuth at 5500K, a cool ambient fill at 20% key intensity from the
opposite side, and a shadow cast to the bottom-right at 40% opacity with 15px blur at
1024px render size. The shadow SHALL be baked into the asset's alpha image and
contained within the object's footprint plus at most one tile of bleed. The scene
renderer SHALL NOT cast runtime shadows between objects.

#### Scenario: Two assets are placed side by side in a scene
- **WHEN** both are drawn on the same canvas
- **THEN** their shadows fall in the same direction with the same softness, so the
  scene reads as a single lit space

#### Scenario: An asset's shadow extends far beyond its footprint
- **WHEN** a delivered asset's baked shadow spills more than one tile past its
  footprint
- **THEN** it is rejected, because it will darken unrelated neighbouring objects

### Requirement: Every kit asset shares one anchor and output contract
The system SHALL require each asset to be rendered at 1024×1024px and delivered as
512×512 WebP with an alpha channel plus the 1024px original for wall displays, on a
fully transparent background with at least 32px of transparent margin on all sides at
1024px. The object's base centre SHALL sit at exactly 50% of image width and 75% of
image height. Files SHALL be named `kit/<vertical>/<object>_<variant>.webp` in
lowercase with underscores.

#### Scenario: An asset is placed at a scene coordinate
- **WHEN** the scene places an object at a normalised canvas position
- **THEN** the asset's base centre lands on that position, because every asset in the
  kit agrees where its feet are

#### Scenario: An asset is centred on its bounding box instead of its base
- **WHEN** a tall asset was exported centred vertically rather than anchored at 75%
- **THEN** it is rejected, because it will float above or sink below the ground plane
  relative to its neighbours

### Requirement: Every kit asset ships a sidecar declaring geometry the image cannot express
The system SHALL require each asset to ship a JSON sidecar declaring `id`,
`footprint` (`w`, `d` in tiles), `height`, `anchor`, named `sockets` (normalised
attachment points with a side), and named `overlayZones` (normalised regions where
the SVG overlay draws state). The scene renderer SHALL read placement, connection and
overlay geometry from this sidecar and SHALL NOT infer any of it from the image.

#### Scenario: A raster object is depth-sorted against a neighbour
- **WHEN** the scene orders a raster object
- **THEN** it uses the sidecar's `footprint` bounds, identically to how it orders an
  SVG template object

#### Scenario: A flow line attaches to a raster object
- **WHEN** a scene connection targets the object's `dc_in` socket
- **THEN** the socket resolves from the sidecar to a normalised point in asset space,
  which the scene projects into canvas space

#### Scenario: A status ring is drawn on a raster object
- **WHEN** the object's binding resolves to a state
- **THEN** the overlay primitive is drawn into the sidecar's declared `status_led`
  overlay zone, keeping art and overlay registered

#### Scenario: An asset is delivered without a sidecar
- **WHEN** a WebP arrives with no accompanying JSON
- **THEN** it is not accepted into the kit, because the renderer cannot place it

### Requirement: The kit shares one material palette and bakes no state colour
The system SHALL require kit assets to draw their materials from the shared palette —
steel `#8A9299`, painted mild `#5A6670`, plastic `#3E464C`, glass `#1E2A30`, concrete
`#7C7970`, soil `#4A3620`, foliage `#3E5E33` — at low saturation. Status, flow and
alarm colours SHALL appear only in the overlay layer. An asset SHALL NOT bake a
status colour, indicator light, glow or motion cue into its image.

#### Scenario: A tank and a cabinet appear in the same scene
- **WHEN** both are rendered
- **THEN** their steel reads as the same material, because both drew from the shared
  palette rather than being colour-picked independently

#### Scenario: An asset was rendered with a green running light
- **WHEN** the asset contains a baked status colour
- **THEN** it is rejected, because a green PNG cannot become red when the device
  faults

### Requirement: Assets are neutral-state only, with variants resisted
The system SHALL require exactly one mandatory render per asset — the neutral state.
A night variant MAY be produced only where a vertical ships a day/night backdrop. The
system SHALL NOT accept state variants such as a separate running or stopped render;
state belongs to the overlay layer.

#### Scenario: A pump needs to show it is running
- **WHEN** the requirement for a running appearance arises
- **THEN** it is satisfied by the overlay's rotor primitive over the neutral asset,
  not by a second asset file

#### Scenario: A vertical needs a house with and without an EV charger
- **WHEN** an optional sub-object is requested as a variant of a larger asset
- **THEN** it is produced as a separate placeable asset instead, because variant
  combinations grow multiplicatively

### Requirement: Rejected assets are recorded with a reason and never repaired
The system SHALL maintain a rejection library holding each rejected render together
with a one-line reason. A rejected asset SHALL be regenerated rather than corrected
in post-production.

#### Scenario: A second contributor joins the kit
- **WHEN** they need to learn the standard
- **THEN** the rejection library shows them the specific failures already made, which
  is faster than re-reading the specification

#### Scenario: An asset fails on one criterion only
- **WHEN** an otherwise-good asset has the wrong shadow direction
- **THEN** it is logged as rejected with that reason and regenerated, because
  post-fixing shadow direction reintroduces drift the rig exists to prevent

### Requirement: A generated asset commits its inputs alongside its output
Where an asset is produced by a generative image model, the system SHALL commit the
source prompt and every reference image alongside the delivered file, because the
models used provide no seed parameter and an asset cannot otherwise be reproduced.

#### Scenario: An asset needs a small change six months later
- **WHEN** a maintainer wants to regenerate one asset consistently with the kit
- **THEN** the committed prompt and reference images give the closest achievable
  reproduction, and the acceptance criteria decide whether the result is usable

#### Scenario: An asset was generated with no recorded prompt
- **WHEN** the asset is delivered with only the image
- **THEN** it is not accepted, because it is unmaintainable
