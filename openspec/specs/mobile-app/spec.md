## Purpose
`mobile/` (`gito_mobile`, Flutter 3.24.5 / Dart 3.5.4, targets iOS/Android/Web) is a second client against the same FastAPI backend as `web/`: login, dashboard viewing (KPI/chart/gauge widgets), device list/detail with a native HMI renderer, alarm acknowledge/clear, and a fleet analytics screen. Feature-first Clean Architecture with BLoC. `mobile/proxy.py` is a local dev-only TCP relay, not part of the shipped app.

## Requirements

### Requirement: Every network call goes through a repository, never `ApiClient` directly from a widget
The system SHALL route all HTTP access through a `*Repository` class (`DeviceRepository`, `DashboardRepository`, `AlarmRepository`, `AuthRepository`, `DeviceTypeRepository`) that wraps a shared `ApiClient` (Dio) whose `AuthInterceptor` attaches `Authorization: Bearer <token>` and whose `ErrorInterceptor` maps HTTP status codes to typed `AppException`s.

#### Scenario: A widget needs device data
- **WHEN** `DeviceListScreen` needs the device list
- **THEN** it dispatches a BLoC event that calls `DeviceRepository.getDevices()`, never calling `ApiClient` inline

#### Scenario: Response unwrapping differs by endpoint shape
- **WHEN** a repository parses a single-object endpoint (e.g. `GET /devices/{id}`)
- **THEN** it calls `Model.fromJson(response.data!)` directly; for list/paginated endpoints it reads `response.data!['data'] as List` — the two are not interchangeable, per `mobile/CLAUDE.md`'s documented API contract

### Requirement: JWT is stored exclusively in platform secure storage, never SharedPreferences
The system SHALL persist the access token via `flutter_secure_storage` (`TokenStorage`) — Keychain on iOS, EncryptedSharedPreferences on Android, `sessionStorage` on the Flutter Web target — and SHALL decode `tenant_id`/`role`/`sub` client-side from the stored JWT (`AuthService`) for every tenant-scoped API path, never hardcoding a tenant id.

#### Scenario: App restart
- **WHEN** the app is relaunched after being fully closed
- **THEN** the token survives (secure storage, not in-memory) and `AuthBloc` can restore an authenticated session without re-login

#### Scenario: Route access before auth resolves
- **WHEN** `GoRouter`'s `redirect` callback sees `AuthInitial` or `AuthLoading`
- **THEN** it returns `null` (no redirect yet) rather than bouncing to `/login` prematurely; only `AuthUnauthenticated` forces a redirect to `/login`, and `AuthAuthenticated` on the login route redirects to `/dashboard`

### Requirement: Dashboard widgets are a strict subset of the web app's, with gauge fully implemented ahead of the web widget-config UI
The system SHALL implement `kpi_card` (stub), `chart` (stub, telemetry wiring incomplete per `mobile/CLAUDE.md`'s own widget table), and `gauge` (implemented, `ArcGaugePainter`-backed `GaugeWidget`); `map` and `table` widget types are not implemented on mobile.

#### Scenario: A dashboard widget of type "map" is rendered
- **WHEN** `DashboardViewScreen` encounters a widget with `widget_type: "map"`
- **THEN** per the mobile widget-type table there is no Flutter widget for it yet (documented as "Not yet") — behavior is whatever the render-switch's fallback case does, distinct from the web app which has a working `MapWidget`

#### Scenario: A gauge widget renders
- **WHEN** a dashboard widget has `widget_type: "gauge"`
- **THEN** `GaugeWidget` reads `config.min`/`max`/`unit`/`thresholds` and paints an arc via `ArcGaugePainter`, using `MetricFormatter.normalize(value, min, max)` to map the value into the 0.0–1.0 sweep range

### Requirement: Device visualization uses a category-keyword HMI dispatcher mirroring the web app's approach
The system SHALL classify a device into `sensor`/`meter`/`gateway`/`tracker`/`actuator`/`generic` by substring-matching `device.deviceType.toLowerCase()` against fixed keyword lists (`HMIRenderer._detectCategory`) and route to `SensorRenderer`, `MeterRenderer`, or `GenericRenderer` (`CustomPainter`-based) accordingly — gateway/tracker/actuator categories are detected but currently fall through to no dedicated renderer in the switch (only `sensor`, `meter`, and the `_` wildcard `GenericRenderer` are handled).

#### Scenario: Device type string contains "pump"
- **WHEN** `device.deviceType` is `"Booster Pump"`
- **THEN** `_detectCategory` returns `meter` (matches the `pump` keyword) and `MeterRenderer` is used

#### Scenario: Device type matches "gateway" but the switch has no case for it
- **WHEN** `_detectCategory` returns `gateway`
- **THEN** the `switch` expression's `_` wildcard catches it and `GenericRenderer` is used, identical to any unrecognized category — the category detection exists but has no distinct visual treatment yet

### Requirement: Real-time telemetry uses a device-scoped WebSocket with bounded reconnect, falling back to 30s polling
The system SHALL connect `DeviceWebSocketClient` to `{baseWsUrl}/api/v1/ws/devices/{deviceId}?token={jwt}` (matching the web app's `useDeviceWebSocket` hook and endpoint, not the dashboard's tenant-scoped `/ws/tenants/{id}/telemetry` endpoint), awaiting `channel.ready` so a failed upgrade throws inside the connect `try/catch` instead of crashing the isolate, and cap reconnect attempts at 5 (vs. the web dashboard's 10).

#### Scenario: WebSocket upgrade fails immediately (server down / 403)
- **WHEN** `_channel!.ready` rejects
- **THEN** the exception is caught inside `connect()` rather than propagating as an unhandled async error

#### Scenario: No token available
- **WHEN** `TokenStorage.getToken()` returns null
- **THEN** `connect()` returns early without attempting a WebSocket connection

### Requirement: `proxy.py` is a local development bridge, not a production component
The system SHALL, via `mobile/proxy.py`, forward all TCP bytes from `0.0.0.0:9000` to `127.0.0.1:8000` so an Android emulator (which cannot reach the host's `127.0.0.1` directly for the dockerized API) can reach the locally running backend at `http://10.0.2.2:9000`. This script ships in the repo but is not part of any build or deployment artifact.

#### Scenario: Developer runs the Android emulator against a local Docker backend
- **WHEN** the developer runs `python proxy.py` and launches the app with `--dart-define=API_BASE_URL=http://10.0.2.2:9000`
- **THEN** requests from the emulator reach the host's `127.0.0.1:8000` (the Docker-mapped API port) via the raw socket relay
