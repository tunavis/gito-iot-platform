## Purpose
A library of animated SVG "digital twin" illustrations (tank, meter, pump, generator, solar, HVAC, valve, motor) that auto-bind a device type's telemetry schema onto visual slots (fill level, flow arrows, running/stopped status, etc.) without per-device configuration. Implemented in `web/src/components/DeviceTemplates/` (26 files: 8 templates, animation primitives, a category-matching resolver).

## Requirements

### Requirement: Templates are auto-selected from device type category by keyword match
The system SHALL, in `resolveTemplate(category, schema, explicitConfig)`, first honor an explicit `deviceType.metadata?.visualization_config` if present, otherwise match `category` (lowercased, spaces/hyphens normalized to underscores) against a fixed keyword table for 8 templates (`water_tank`, `water_meter`, `pump`, `generator`, `solar_system`, `hvac_unit`, `valve`, `motor`), and return `null` if no keyword matches — meaning devices whose category isn't one of these get no illustration.

#### Scenario: Category matches a keyword
- **WHEN** a device type's category is `"submersible"` (matches the `pump` keyword list)
- **THEN** `resolveTemplate` returns a `TemplateConfig` with `template: "pump"`

#### Scenario: Category matches nothing
- **WHEN** a device type's category is e.g. `"environmental_sensor"`
- **THEN** `resolveTemplate` returns `null` and callers are expected to fall back to a plain metric grid

### Requirement: Schema fields bind to visual slots by candidate-name matching, exact match preferred over substring
The system SHALL, for each template's declared slots (e.g. `water_tank.level` candidates `["tank_level", "level", "fill_level", "volume_percent", "fill", "water_level"]`), search the device type's `telemetry_schema` for an exact key match first, then a case-insensitive substring match, and SHALL never bind the same schema key to two slots (`used` set tracked across slots and the status binding).

#### Scenario: Schema has an exact match
- **WHEN** the schema declares `tank_level`
- **THEN** the `level` slot binds to `tank_level` directly, without falling through to substring matching

#### Scenario: Schema has only a near-miss key
- **WHEN** the schema declares `water_level_pct` (no exact candidate match, but contains `level`)
- **THEN** the `level` slot binds to `water_level_pct` via substring match, since `"level"` is one of the level-slot candidates

#### Scenario: A status boolean is also claimed by a numeric slot
- **WHEN** a key like `pump_running` would match both a numeric slot's candidates and the status-binding candidates
- **THEN** whichever binder runs first (slots are resolved before status in `resolveTemplate`) claims the key via the `used` set, and the other binder skips it

### Requirement: The template gallery is a dev-only, unlinked route — not wired into the live device detail page
The system SHALL expose all 8 templates with labeled sample fixtures at `/dev/templates` (`web/src/app/dev/templates/page.tsx`) for visual QA; this route is explicitly commented `"Not linked from any navigation"` and is the *only* place in `web/src/app/` that imports `TemplateRenderer` or `resolveTemplate`.

#### Scenario: A developer wants to preview the Water Tank template
- **WHEN** they navigate directly to `/dev/templates`
- **THEN** they see all 8 templates rendered with fixture data, independent of any real device or device type

#### Scenario: A tenant user views a real device's detail page
- **WHEN** they open `/dashboard/devices/{id}`
- **THEN** no digital-twin illustration is shown — `DeviceTemplates` components are not referenced from `web/src/app/dashboard/devices/[id]/page.tsx` or anywhere else in the production page tree, so the entire template system is currently unreachable outside the dev route
