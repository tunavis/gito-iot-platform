## Purpose
Lets a tenant admin define and evolve device type templates: identity/category, a unified metrics model, capabilities, default operational settings, and connectivity protocol. Implemented in `web/src/app/dashboard/device-types/` including the (currently uncommitted-locally) `[id]/_components/` view. This is the authoring surface that produces the `telemetry_schema` other specs (dashboard-builder, widget-config) read from.

## Requirements

### Requirement: Detail page has two mutually exclusive modes — view and edit
The system SHALL render `DeviceTypeView` (read-only) by default for an existing device type and switch to `DeviceTypeEdit` (form) only after the user clicks "Edit"; creating a new device type (`params.id === 'new'`) SHALL start directly in edit mode.

#### Scenario: Opening an existing device type
- **WHEN** a user navigates to `/dashboard/device-types/{id}`
- **THEN** the page fetches `GET /tenants/{tenant}/device-types/{id}`, populates the form from the response, and renders `DeviceTypeView` with mode `"view"`

#### Scenario: Cancelling an edit
- **WHEN** the user clicks "Cancel" while editing an existing (non-new) device type
- **THEN** the form is discarded, `error` is cleared, and mode reverts to `"view"` without re-fetching

#### Scenario: Cancelling a new device type
- **WHEN** the user clicks "Cancel" while `isNew` is true
- **THEN** the router navigates back (`router.back()`) instead of switching to a view mode that has no data

### Requirement: Metrics are edited as one unified list, then split into three backend columns on save
The system SHALL present all telemetry fields in a single `MetricsTable` regardless of whether a field is a plain schema entry, a byte-decoded LoRaWAN payload field, or a renamed raw key — merged client-side by `mergeMetrics(data_model, decoder, key_mapping)` on load and re-split by `splitMetrics(metrics, decoderFPort)` into `{data_model, decoder, key_mapping}` on save, so the backend's three stored columns never drift out of sync.

#### Scenario: A metric is byte-decoded from a LoRaWAN payload
- **WHEN** a metric's source mode is `"decode"` (has offset/length/byteType from `decoder.fields`)
- **THEN** `DeviceTypeView` shows a "how it arrives" badge with the byte offset, type, and scale (e.g. `uint16 @0 ×0.1`), and saving re-emits that field into `decoder.fields` rather than `key_mapping`

#### Scenario: A metric is a renamed raw key
- **WHEN** a raw MQTT/HTTP payload key doesn't match the canonical schema name
- **THEN** `key_mapping[rawKey] = canonicalName` round-trips through the unified editor as `source: {mode: "rename", rawKey}`, shown as `← rawKey` in view mode

#### Scenario: Decode wins over rename for the same field
- **WHEN** a field has both a decoder entry and a key_mapping entry pointing to it (per `mergeMetrics` logic)
- **THEN** the decode source takes precedence and the rename is not separately represented

### Requirement: Discovered Metrics panel surfaces telemetry fields not yet in the schema
The system SHALL fetch `GET /tenants/{id}/device-types/{id}/discovered-metrics?days=7` (existing device types only, not `isNew`) and, in edit mode, let the user either add an undeclared key as a new direct metric or map it (rename) onto an existing metric name; in view mode the panel is read-only status display.

#### Scenario: A raw key is unmapped and undeclared
- **WHEN** a discovered key is neither in `currentFieldNames` nor `renameMap`
- **THEN** it renders with an amber warning icon and, in edit mode, offers both a "Map to…" dropdown (existing fields) and a "+ Add" button (declare as new field)

#### Scenario: A raw key is already declared
- **WHEN** a discovered key matches a name in `currentFieldNames`
- **THEN** it renders with a green checkmark and no action controls

### Requirement: Save requires a non-empty name and reports backend validation errors inline
The system SHALL block submission client-side if `form.name` is blank ("Name is required") and SHALL surface the backend's `err.detail` string in the same inline error banner on a non-2xx response from `POST`/`PUT /tenants/{id}/device-types[/{id}]`.

#### Scenario: Successful create
- **WHEN** `POST` succeeds for a new device type
- **THEN** a success toast fires and the user is redirected to `/dashboard/device-types` (the list)

#### Scenario: Successful update
- **WHEN** `PUT` succeeds for an existing device type
- **THEN** a success toast fires, the device type is re-fetched, and mode reverts to `"view"` (stays on the same page)
