## Purpose
Lets a tenant user assemble a grid of live-data widgets into a named, savable dashboard. Covers the drag/resize grid canvas, widget lifecycle (add/configure/remove), layout persistence, and the real-time telemetry feed that updates widgets without polling. Implemented in `web/src/components/DashboardBuilder/` (`DashboardGrid.tsx`, `WidgetLibrary.tsx`) and consumed from `web/src/app/dashboard/`.

## Requirements

### Requirement: Grid layout is drag/resize editable only in edit mode
The system SHALL render widgets on a responsive 12-column grid (`react-grid-layout` v1.4.4, `DashboardGrid.tsx`) and SHALL only allow dragging and resizing when `isEditMode` is true; in view mode the grid is static.

#### Scenario: Owner edits layout
- **WHEN** a user opens a dashboard in edit mode and drags a widget to a new cell
- **THEN** `onLayoutChange` fires with updated `position_x`/`position_y`/`width`/`height` for every widget, ready to be persisted via `PUT /tenants/{id}/dashboards/{id}/layout`

#### Scenario: Viewer cannot rearrange
- **WHEN** `isEditMode` is false
- **THEN** `isDraggable` and `isResizable` are both false and the grid renders read-only

### Requirement: Widget library offers twelve widget types across five categories
The system SHALL present a widget picker (`WidgetLibrary.tsx`) listing 12 widget types — `kpi_card`, `gauge`, `stat_group`, `chart`, `pie_chart`, `scatter_plot`, `heatmap`, `alarm_summary`, `table`, `status_matrix`, `map` (plus `device_info`, renderable but not listed in the picker) — grouped into "Metrics & KPIs", "Charts", "Activity", "Data Display", "Fleet Overview", and "Maps & Location", each with a default width/height and default `configuration` object.

#### Scenario: User browses by category
- **WHEN** a user clicks a category tab (e.g. "Charts")
- **THEN** only the 3 chart-category widgets (Time-Series Chart, Pie/Donut Chart, Scatter Plot) are shown

#### Scenario: User adds a widget
- **WHEN** a user selects a widget type from the library
- **THEN** `onSelectWidget` receives the type's `defaultConfig`, `defaultWidth`, and `defaultHeight`, and the library closes

### Requirement: DashboardGrid renders every widget type it advertises, with graceful fallback
The system SHALL switch on `widget.widget_type` in `DashboardGrid.renderWidget()` and render the matching component (`KPICard`, `ChartWidget`, `GaugeWidget`, `DeviceInfoWidget`, `MapWidget`, `TableWidget`, `PieChartWidget`, `StatGroupWidget`, `AlarmSummaryWidget`, `ScatterPlotWidget`, `HeatmapWidget`, `StatusMatrixWidget`), each wrapped in an `ErrorBoundary` keyed to the widget id.

#### Scenario: Unknown widget type
- **WHEN** `widget.widget_type` does not match any case in the switch
- **THEN** the grid renders an "Unknown Widget Type" placeholder card showing the raw type string instead of crashing

### Requirement: Widget data-fetch code must match each backend endpoint's actual response shape, not a copy-pasted assumption
Different routers return different shapes (`SuccessResponse{data}` wrapper vs.
bare object/list) — a repo-wide audit catalogued all of them (see
`openspec/specs/auth-and-identity/spec.md`). Widgets fetching data directly
(not through a shared client) must match the specific endpoint they call, not
whatever convention a similar-looking widget happened to use.

#### Scenario: AlarmSummaryWidget and device-detail alarm views
- **WHEN** `AlarmSummaryWidget.tsx`, the device detail page's recent-alarms
  panel, and its Alarms tab (list + acknowledge + clear) call `GET
  /tenants/{id}/alarms` or `POST .../acknowledge` / `.../clear`
- **THEN** they read `json.alarms` (list) or `json` directly (acknowledge/clear
  — `AlarmSchema` returned bare, no wrapper) — previously all five read
  `json.data`, which is `undefined` for these endpoints (`AlarmListResponse`
  has no `data` field; acknowledge/clear return the alarm directly), so the
  summary widget always showed zero alarms, the device detail panels always
  showed an empty list, and acknowledge/clear silently corrupted local state
  with `undefined`. The top-level `/dashboard/alarms` page was never affected
  — it already read `json.alarms`/bare `json` correctly, which is how the
  mismatch went unnoticed for this long.

#### Scenario: MapWidget with explicit device bindings
- **WHEN** a Map widget has `dataSources` configured (specific devices bound,
  not "show all")
- **THEN** each bound device is fetched via `GET /devices/{id}` and the code
  reads `json.data` — previously it returned the raw parsed response (the
  `SuccessResponse` envelope) instead of unwrapping it, so `latitude`/
  `longitude` were always `undefined` and bound devices never rendered a pin
  (the separate "show all devices" fallback path was unaffected — it already
  unwrapped `.data` correctly)

#### Scenario: One widget throws during render
- **WHEN** a single widget component throws (e.g. malformed `configuration`)
- **THEN** its `ErrorBoundary` contains the failure so the rest of the dashboard continues rendering

### Requirement: Real-time telemetry arrives over a per-tenant WebSocket, not polling
The system SHALL open a WebSocket to `/api/v1/ws/tenants/{tenantId}/telemetry?token={jwt}` (`useDashboardWebSocket` hook) whenever the dashboard is in view mode, merge incoming `{type:"telemetry", device_id, data}` messages into a `realtimeData` map keyed by `device_id`, and pass the matching slice to `KPICard` as `realtimeData`.

#### Scenario: Dashboard is in edit mode
- **WHEN** `isEditMode` is true
- **THEN** the WebSocket hook is called with `enabled: false` and does not connect (avoids fighting live updates while the user repositions widgets)

#### Scenario: Connection drops
- **WHEN** the WebSocket `onclose` fires and fewer than 10 reconnect attempts have been made
- **THEN** the client reconnects with exponential backoff (1s doubling, capped at 30s) and sends a `{"type":"ping"}` keepalive every 30s once connected

### Requirement: Tenant context is derived client-side from the stored JWT, not passed as a prop
The system SHALL decode `tenant_id` from the JWT stored in `localStorage["auth_token"]` inside `DashboardGrid` itself (`JSON.parse(atob(token.split(".")[1]))`) rather than requiring callers to supply it.

#### Scenario: No token present
- **WHEN** `localStorage.getItem("auth_token")` returns null or the token fails to parse
- **THEN** `token` and `tenantId` resolve to empty strings and the WebSocket hook simply does not connect (no thrown error)
