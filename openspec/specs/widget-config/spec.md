## Purpose
Governs how a widget gets bound to device telemetry and how its display options are edited, via `WidgetConfigModal.tsx` and `DeviceBindingModal.tsx`. This is the schema-driven UX described in root `CLAUDE.md`: device -> device type -> telemetry schema -> metric dropdown -> auto-filled unit/min/max.

## Requirements

### Requirement: Device binding is schema-first with a live-telemetry and free-text fallback chain
The system SHALL, when a device is selected in `DeviceBindingModal`, fetch that device's `device_type.telemetry_schema` (`GET /tenants/{id}/device-types/{id}`) and the device's last 24h of telemetry (`GET /tenants/{id}/devices/{id}/telemetry?per_page=1`) in parallel, then offer metrics in this priority order: (1) schema-declared fields, annotated with a checkmark if also seen live; (2) if no schema, live telemetry keys seen in the last 24h; (3) if neither, a free-text input for manual metric-key entry.

#### Scenario: Device has a schema and recent telemetry
- **WHEN** the user selects a device whose type declares `temperature: {type: float, unit: "°C"}` and telemetry arrived in the last 24h
- **THEN** the metric dropdown shows "Temperature (°C) ✓" under "Declared fields", and any live keys not in the schema appear under a separate "Discovered from telemetry" optgroup

#### Scenario: Device has no device_type_id
- **WHEN** the selected device's `device_type_id` is null
- **THEN** schema fetch is skipped (`schema` set to `{}` directly) and the picker falls back to live telemetry keys or free text

### Requirement: Numeric-only widgets reject non-numeric metric bindings
The system SHALL treat `gauge`, `kpi_card`, and `stat_group` as numeric-only widget types and disable (not hide) any schema field whose `type` is not `float`/`integer`/`number`, showing a compatibility warning banner when such a field is selected.

#### Scenario: User picks a boolean field for a gauge
- **WHEN** the widget type is `gauge` and the selected schema field has `type: "boolean"`
- **THEN** the option is rendered `disabled` with the label suffix "— not numeric" and a warning banner reads: `"<field>" is type Boolean — gauge widgets require a numeric field.`

### Requirement: Chart widgets support multi-device, multi-metric binding; all others are single-binding
The system SHALL set `multiDevice = (widgetType === "chart")`; only chart widgets accumulate multiple bindings via repeated "Add to chart" clicks, while every other widget type replaces its single binding on each save.

#### Scenario: User adds a second series to a chart
- **WHEN** widget type is `chart` and the user adds a binding while one already exists
- **THEN** the new binding is appended to the existing `bindings` array (not replacing it)

#### Scenario: User rebinds a KPI card
- **WHEN** widget type is `kpi_card` and the user clicks "Bind device" with a new selection
- **THEN** `bindings` is replaced with a single-element array containing only the new binding

### Requirement: Saving a binding auto-populates title and config from schema metadata
The system SHALL, in `WidgetConfigModal.handleSaveBindings`, auto-generate a widget title from the bound device/metric names (unless the user has manually typed a title) and, for a single binding, copy `unit` into `config.unit` and — for `gauge` widgets — copy schema `min`/`max` into `config.min`/`config.max`.

#### Scenario: User has not touched the title field
- **WHEN** one binding is saved with `metric: "temperature"`, `device_name: "Tank 3"`
- **THEN** the title auto-fills to `"Temperature - Tank 3"`

#### Scenario: User already typed a custom title
- **WHEN** `titleManuallyEdited.current` is true
- **THEN** saving a new binding does not overwrite the user's title

### Requirement: Per-type configuration forms exist for 8 of the 12 widget types
The system SHALL render a dedicated configuration form for `kpi_card`, `chart`, `gauge`, `pie_chart`, `stat_group`, `alarm_summary`, `scatter_plot`, and `heatmap`; for any other widget type (`table`, `map`, `status_matrix`, `device_info`) it SHALL fall back to a "No configuration available for this widget type" message.

#### Scenario: User opens config for a Table widget
- **WHEN** `widgetType === "table"`
- **THEN** `renderConfigForm()` hits the `default` case and shows the "No configuration available" placeholder — the widget can still be added and bound, but has no dedicated settings UI

#### Scenario: User opens config for a Gauge widget
- **WHEN** `widgetType === "gauge"`
- **THEN** the form exposes min/max, unit, decimal places, warning/critical thresholds, three color-zone pickers, and a "show value" toggle
