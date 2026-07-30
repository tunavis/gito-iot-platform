## ADDED Requirements

### Requirement: A scene is a versioned document with normalised placement coordinates
The system SHALL persist a scene as a JSON document carrying a `schema` integer
version (`1` for this change), a `backdrop` reference, a fixed `aspect` ratio, and a
list of placed `objects`. Every object position SHALL be stored as normalised `0..1`
fractions of the canvas in both axes, never as pixels. The viewer SHALL reject a
scene whose `schema` version it does not recognise rather than rendering it
partially.

#### Scenario: A scene is saved and reloaded at a different viewport size
- **WHEN** a scene authored on a 1920px-wide desktop is opened on a 390px-wide phone
- **THEN** every object appears at the same relative position within the canvas,
  because positions are fractions and the canvas keeps its declared aspect ratio

#### Scenario: A scene document declares an unknown schema version
- **WHEN** the viewer loads a scene with `"schema": 2` and only understands version 1
- **THEN** it renders an explicit "scene format not supported" state and renders no
  objects, rather than silently dropping the fields it does not understand

#### Scenario: A stored position would be ambiguous in pixels
- **WHEN** a scene object is persisted
- **THEN** its stored `x` and `y` are in the inclusive range `0..1` and the API
  rejects values outside that range with a 422

### Requirement: Scenes are tenant-scoped with explicit tenant filtering
The system SHALL expose scene CRUD under `/tenants/{tenant_id}/scenes`, SHALL return
403 when the path `tenant_id` does not match the JWT `tenant_id`, SHALL call
`set_tenant_context` before queries, and SHALL additionally constrain every scene
query with an explicit `WHERE tenant_id = :tenant_id` predicate rather than relying
on PostgreSQL RLS, because the application connects as a role for which RLS is not
enforced.

#### Scenario: A user requests a scene belonging to another tenant
- **WHEN** a user whose token carries tenant A calls
  `GET /tenants/{B}/scenes/{scene_id}`
- **THEN** the API responds 403 without querying the scene

#### Scenario: A scene id from another tenant is requested under the caller's own tenant path
- **WHEN** a tenant-A user calls `GET /tenants/{A}/scenes/{scene_id}` where the
  scene row belongs to tenant B
- **THEN** the API responds 404, because the query's explicit `tenant_id` predicate
  excludes the row

### Requirement: Every bound reading is normalised to 0..1 before reaching a component
The system SHALL resolve each scene binding (device + metric) to a numeric reading,
SHALL map it through the binding's configured `min`/`max` to a clamped `0..1` value,
and SHALL pass that normalised value to the rendering component. Rendering
components SHALL NOT receive engineering units for the purpose of driving visual
magnitude.

#### Scenario: A tank level in litres drives a fill
- **WHEN** a binding declares `min: 0`, `max: 5000` and the device reports `3500`
- **THEN** the level component receives `0.7`

#### Scenario: A reading exceeds its configured maximum
- **WHEN** a binding declares `max: 5000` and the device reports `6200`
- **THEN** the component receives `1.0`, not `1.24`, and the scene does not render
  overflowing geometry

#### Scenario: The same component serves two different device types
- **WHEN** a rotor component is bound to a pump reporting `rpm` and to a fan
  reporting `duty_percent`
- **THEN** both resolve to `0..1` through their own min/max and the same component
  renders both without a device-type-specific branch

### Requirement: Motion is clamped to a bounded rate, never driven directly from a reading
The system SHALL map a normalised value to an animation rate within a declared
minimum and maximum bound. An animation duration or frequency SHALL NOT be computed
as a direct function of a raw reading.

#### Scenario: A pump reports its maximum value
- **WHEN** a bound rotor receives `v = 1.0`
- **THEN** it animates at the configured maximum rate, which is slow enough to read
  as rotation rather than strobing

#### Scenario: A reading arrives as zero or missing
- **WHEN** a bound rotor receives `v = 0` or its binding has no fresh reading
- **THEN** the rotor is stationary rather than animating at an undefined rate

### Requirement: Stale and offline are first-class scene states
The system SHALL classify every bound scene object into exactly one of
`running | idle | fault | stale | offline`, SHALL treat a reading older than the
binding's configured freshness window as `stale`, and SHALL NOT render a stale
reading as a confident current value.

#### Scenario: A device stopped reporting three days ago
- **WHEN** an object's newest reading is older than its freshness window
- **THEN** the object renders in the stale state with its last-seen timestamp
  visible, and its animated motion stops

#### Scenario: A device has never reported
- **WHEN** a scene object is bound to a device with no telemetry at all
- **THEN** the object renders `offline`, distinct from `idle`

### Requirement: Fault is never signalled by colour alone
The system SHALL accompany every fault or alarm state with a non-colour signal —
a shape, notch, dashed outline, or icon — in addition to any colour change, and
SHALL use the same state grammar (same indicator position, same wording) for every
device type in a scene.

#### Scenario: A user with red/green colour blindness views a faulted pump
- **WHEN** a pump object enters `fault`
- **THEN** the object carries a distinct shape signal that is discriminable in
  greyscale, not only a red tint

#### Scenario: A technician learns the indicator on one device type
- **WHEN** they then view a different device type in the same scene
- **THEN** the state indicator occupies the same relative position and uses the same
  label vocabulary

### Requirement: The viewer preserves the scene, and pans and zooms rather than reflowing
The system SHALL render the scene canvas at its declared fixed aspect ratio on every
target surface, and SHALL provide pan and zoom on small viewports. The viewer SHALL
NOT reflow, stack, or re-lay-out scene objects to fit a narrow viewport.

#### Scenario: A scene is opened on a phone in the field
- **WHEN** the canvas is wider than the viewport
- **THEN** the user pans and pinch-zooms the scene, and the spatial relationships
  between objects are unchanged

### Requirement: Objects are depth-ordered by footprint bounds, not by a single coordinate
The system SHALL order overlapping scene objects using painter's ordering derived
from each object's declared footprint bounds, or an equivalent pairwise-occlusion
ordering. The system SHALL NOT sort solely by `x + y` of an object's anchor, which
is only correct for 1×1 footprints.

#### Scenario: A multi-tile object neighbours a small one
- **WHEN** a 3×2-footprint object and a 1×1-footprint object overlap on screen and
  the small object is behind the large one in scene space
- **THEN** the large object is drawn in front, and the small object is not visible
  through it

### Requirement: The viewer enforces a concurrent-animation budget
The system SHALL cap the number of simultaneously animating scene objects at a
declared limit, and when a scene exceeds that limit SHALL automatically drop the
optional motion classes (wave, flow, particle) while preserving static state
indication.

#### Scenario: A dense site scene runs on a wall display
- **WHEN** a scene contains more bound objects than the animation budget allows
- **THEN** wave and flow animations are suppressed, every object still shows its
  correct state, and the frame rate stays within budget

### Requirement: Every scene has an equivalent list view of the same bound devices
The system SHALL provide, for every scene, a list rendering of the same bound
devices with their current values, units and states, reachable from the scene and
navigable by keyboard and screen reader.

#### Scenario: A screen-reader user opens a scene
- **WHEN** they navigate the scene route
- **THEN** the list view presents every bound device, its value with unit, and its
  state as text

#### Scenario: The connection is too slow to render the scene
- **WHEN** the backdrop and object art fail to load
- **THEN** the list view still presents current values and states

### Requirement: Flow connections are hand-authored between declared object sockets
The system SHALL render flow connections between named sockets on placed objects
using paths stored in the scene document, and SHALL animate a connection's flow rate
from a normalised binding. The system SHALL NOT compute connection routing
automatically in this change.

#### Scenario: A pump feeds a reservoir
- **WHEN** the scene declares a connection from the pump's `out` socket to the
  reservoir's `in` socket with a flow binding
- **THEN** the connection renders along its authored path with motion proportional
  to the clamped normalised flow value

#### Scenario: A connection references a socket that does not exist
- **WHEN** a stored connection names a socket absent from the object's metadata
- **THEN** the viewer omits that connection and surfaces a scene-validation warning,
  rather than rendering a path to the object's origin
