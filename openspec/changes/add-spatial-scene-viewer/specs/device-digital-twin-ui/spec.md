## ADDED Requirements

### Requirement: Every template declares placement metadata for scene composition
The system SHALL, for each of the 8 templates, declare a placement descriptor
containing `footprint` (`w`, `d` in grid tiles), `anchor` (the normalised point in
the template's own viewBox where its base sits), and named `sockets` (normalised
attachment points for flow connections). The scene layer SHALL read this descriptor
rather than inferring geometry from the rendered SVG.

#### Scenario: A pump is placed in a scene
- **WHEN** the scene layer places the `pump` template
- **THEN** it reads the template's `anchor` to align the pump's base to the placement
  point, and its `footprint` to depth-order it against neighbours

#### Scenario: A flow connection attaches to a template
- **WHEN** a scene connection targets the `pump` template's `out` socket
- **THEN** the socket resolves to a normalised coordinate within the template's
  viewBox, which the scene projects into canvas space

#### Scenario: A template has no declared socket for a requested name
- **WHEN** a connection names a socket the template does not declare
- **THEN** the descriptor lookup returns undefined and the scene omits the
  connection, as required by the scene-validation behaviour

## MODIFIED Requirements

### Requirement: The template gallery is a dev-only, unlinked route — not wired into the live device detail page
The system SHALL continue to expose all 8 templates with labeled sample fixtures at
`/dev/templates` (`web/src/app/dev/templates/page.tsx`) for visual QA, and this route
SHALL remain unlinked from navigation. `TemplateRenderer` and `resolveTemplate` SHALL
additionally be reachable from the production page tree via the scene viewer, which
renders resolved templates as placed scene objects bound to real devices. The device
detail page remains out of scope for this change and still shows no illustration.

#### Scenario: A developer wants to preview the Water Tank template
- **WHEN** they navigate directly to `/dev/templates`
- **THEN** they see all 8 templates rendered with fixture data, independent of any
  real device or device type

#### Scenario: A tenant user opens a scene containing a water tank
- **WHEN** the scene has an object bound to a device whose type category resolves to
  the `water_tank` template
- **THEN** the scene renders that template via `TemplateRenderer` with live
  normalised values, so the template system is reachable in production

#### Scenario: A tenant user views a real device's detail page
- **WHEN** they open `/dashboard/devices/{id}`
- **THEN** no digital-twin illustration is shown — the device detail page is not
  modified by this change

### Requirement: Templates are auto-selected from device type category by keyword match
The system SHALL, in `resolveTemplate(category, schema, explicitConfig)`, first honor an explicit `deviceType.metadata?.visualization_config` if present, otherwise match `category` (lowercased, spaces/hyphens normalized to underscores) against a fixed keyword table for 8 templates (`water_tank`, `water_meter`, `pump`, `generator`, `solar_system`, `hvac_unit`, `valve`, `motor`), and return `null` if no keyword matches — meaning devices whose category isn't one of these get no illustration. A scene object MAY override this resolution by naming a template explicitly in its placement, so an unmatched category does not prevent a device from appearing in a scene.

#### Scenario: Category matches a keyword
- **WHEN** a device type's category is `"submersible"` (matches the `pump` keyword list)
- **THEN** `resolveTemplate` returns a `TemplateConfig` with `template: "pump"`

#### Scenario: Category matches nothing
- **WHEN** a device type's category is e.g. `"environmental_sensor"`
- **THEN** `resolveTemplate` returns `null` and callers are expected to fall back to a plain metric grid

#### Scenario: A scene object names its template explicitly
- **WHEN** a scene object declares `template: "water_tank"` for a device whose
  category matches no keyword
- **THEN** the scene renders the named template rather than falling back, because the
  explicit placement wins over category resolution

#### Scenario: A status boolean is also claimed by a numeric slot
- **WHEN** a key like `pump_running` would match both a numeric slot's candidates and the status-binding candidates
- **THEN** whichever binder runs first (slots are resolved before status in `resolveTemplate`) claims the key via the `used` set, and the other binder skips it
