## REMOVED Requirements

### Requirement: Every network call goes through a repository, never `ApiClient` directly from a widget
**Reason**: Described the deleted Flutter app's Dio/`ApiClient` layering. The
principle survives in the Expo rebuild — no component calls the network
directly — but it is restated against a client generated from the API's own
OpenAPI schema rather than a hand-written Dio wrapper.
**Migration**: See "All API access goes through a client generated from the
platform's OpenAPI schema" below.

### Requirement: JWT is stored exclusively in platform secure storage, never SharedPreferences
**Reason**: Named Flutter-specific storage (`flutter_secure_storage`,
EncryptedSharedPreferences) and a Flutter Web target that is out of scope. The
security property is retained against Expo's equivalent.
**Migration**: See "The access token lives in platform secure storage and tenant
identity is derived from it" below.

### Requirement: Dashboard widgets are a strict subset of the web app's, with gauge fully implemented ahead of the web widget-config UI
**Reason**: Documented an incomplete state as if it were intended behaviour —
`kpi_card` and `chart` were stubs with telemetry wiring unfinished, and
`map`/`table` did not exist. A spec should not enshrine stubs.
**Migration**: See "Dashboard widget rendering honours the web app's stored
configuration contract" and "Out-of-scope surfaces are absent, never stubbed"
below.

### Requirement: Device visualization uses a category-keyword HMI dispatcher mirroring the web app's approach
**Reason**: The dispatcher detected `gateway`, `tracker`, and `actuator`
categories and then routed all three to the generic renderer, so the
classification had no behavioural effect for half its cases. Device
visualization is not in Phase 1 scope of the rebuild.
**Migration**: Deferred. Device detail in Phase 1 renders telemetry values and
metadata; visual digital twins are a later change, and will be specified with
renderers that actually exist rather than categories that fall through.

### Requirement: Real-time telemetry uses a device-scoped WebSocket with bounded reconnect, falling back to 30s polling
**Reason**: Correct in substance but written against Flutter's
`DeviceWebSocketClient` and `channel.ready` isolate semantics.
**Migration**: See "Live telemetry uses the device-scoped WebSocket with bounded
reconnect and a polling fallback" below — same endpoint, same bounded-reconnect
property, restated for the Expo client.

### Requirement: `proxy.py` is a local development bridge, not a production component
**Reason**: `mobile/proxy.py` existed solely because an Android emulator cannot
reach a dockerised backend on the host's loopback. Expo's dev server is reached
over the LAN from a physical device, so the relay has no purpose and is not
recreated.
**Migration**: None needed. The contributor runs the app on a physical phone via
Expo Go against the API's LAN address; no TCP relay is involved.

## ADDED Requirements

### Requirement: All API access goes through a client generated from the platform's OpenAPI schema
The system SHALL derive its request and response types from the API's own
`/openapi.json` into a generated types module, and SHALL route every HTTP call
through a typed client over those generated types. No screen, component, or hook
SHALL contain a literal URL path, a hand-written interface describing an API
response, or a string key read off an untyped response object.

#### Scenario: A screen needs the device list
- **WHEN** a device list screen requires data
- **THEN** it calls a typed query hook that resolves its path and response type
  from the generated schema, and the screen file itself contains no URL string

#### Scenario: The contributor invents an endpoint that does not exist
- **WHEN** code references a path or operation absent from the generated schema
- **THEN** the TypeScript build fails before the app runs, rather than the call
  404ing at runtime

#### Scenario: A response shape changes in the API
- **WHEN** a field is renamed or removed in `api/` and types are regenerated
- **THEN** every mobile call site reading that field fails to compile, rather
  than rendering `undefined` on a screen

#### Scenario: List and single-object endpoints are unwrapped differently
- **WHEN** a paginated list endpoint returns `{data: [...], meta: {...}}` and a
  single-object endpoint returns the object directly
- **THEN** the generated types express that difference and the client honours
  each shape as typed, never assuming one uniform envelope

### Requirement: The access token lives in platform secure storage and tenant identity is derived from it
The system SHALL persist the access token via `expo-secure-store` — Keychain on
iOS, Keystore-backed encrypted storage on Android — and SHALL NOT write it to
`AsyncStorage`, unencrypted preferences, or application state that survives to
disk. Tenant id, user id, and role SHALL be decoded from the stored token for
every tenant-scoped request path, and SHALL NOT be hardcoded, bundled, or
entered by hand anywhere in the app.

#### Scenario: The app is relaunched after being fully closed
- **WHEN** the app starts and a previously stored token is still valid
- **THEN** the session is restored from secure storage without a re-login prompt

#### Scenario: A request needs a tenant-scoped path
- **WHEN** any call targets `/api/v1/tenants/{tenant_id}/...`
- **THEN** `tenant_id` comes from decoding the stored token, never from a
  constant, a build-time value, or user input

#### Scenario: Navigation is attempted before auth has resolved
- **WHEN** authentication state is still initialising
- **THEN** the router holds rather than redirecting to login, and only a
  resolved-unauthenticated state sends the user to the login screen

#### Scenario: The token is rejected by the API
- **WHEN** any request returns 401
- **THEN** the stored token is cleared and the user is returned to login, rather
  than the app retrying indefinitely against a dead credential

### Requirement: The API base URL is configuration, never a literal
The system SHALL read its API base URL and WebSocket base URL from Expo
configuration (`app.config.ts` plus environment), and SHALL NOT contain a
hardcoded host, IP address, or port in application source. The same binary
SHALL be able to target a local development API, the staging host, and
production by configuration alone.

#### Scenario: The contributor runs against a local API
- **WHEN** the app is started with the development configuration
- **THEN** it targets the configured LAN address of the local API with no source
  edit, and no TCP relay process is required

#### Scenario: Someone searches the source for a hostname
- **WHEN** grepping application source for an IP address or `http://` host
- **THEN** matches appear only in configuration files, never in screens, hooks,
  or the API client

### Requirement: Visual design derives from one token module
The system SHALL define colour, glass material, gradient, spacing, radius,
typography, and motion-curve values in a single theme module, and screens SHALL
reference those tokens. No component SHALL contain an inline colour literal, an
ad-hoc shadow definition, or a magic spacing number. The theme SHALL be
dark-mode-first, with light mode derived from the same token set rather than a
parallel hand-maintained copy.

#### Scenario: A new screen needs a card surface
- **WHEN** a screen renders a floating glass card
- **THEN** it composes the shared card primitive and shared tokens, and defines
  no blur radius, border colour, or shadow of its own

#### Scenario: A brand colour changes
- **WHEN** the primary colour is changed in the token module
- **THEN** every screen reflects it with no other file edited

### Requirement: Glass, motion, and haptics come from shared primitives
The system SHALL express the intended design language — translucent blurred
surfaces, physics-based motion, press and gesture feedback, and haptics —
through a small set of shared primitives and hooks. Individual screens SHALL
compose those primitives and SHALL NOT re-derive spring configurations, blur
parameters, or haptic invocations per screen. Blur SHALL bind to the platform's
native material rather than being simulated with a translucent overlay.

#### Scenario: A button needs press feedback
- **WHEN** any pressable element is implemented
- **THEN** it uses the shared press-animation hook and the shared haptics helper,
  producing identical feel across every screen

#### Scenario: A list row animates in
- **WHEN** entry animation is applied
- **THEN** it uses a shared motion token (spring config from the theme), so
  timing is consistent app-wide and tunable in one place

#### Scenario: Motion is reduced at the OS level
- **WHEN** the operating system reports a reduce-motion accessibility preference
- **THEN** the shared primitives honour it and suppress non-essential animation,
  rather than each screen deciding independently

### Requirement: Every screen that reads remote data renders loading, empty, and error states explicitly
The system SHALL, for each screen or component that fetches from the API, render
a distinct treatment for in-flight, successful-but-empty, and failed states. A
failure SHALL surface the condition to the user and offer a retry. No screen
SHALL render an indefinite blank surface, a permanent skeleton, or a silently
swallowed error.

#### Scenario: The API is unreachable
- **WHEN** a fetch fails due to network or server error
- **THEN** the screen shows an error state naming the failure and offering retry,
  and the error is not discarded

#### Scenario: A tenant has no devices yet
- **WHEN** the device list returns zero rows
- **THEN** an empty state is rendered, visually distinct from both the loading
  state and an error

#### Scenario: A request is in flight
- **WHEN** data has been requested and not yet returned
- **THEN** a loading treatment is shown that resolves — it does not persist after
  the request settles either way

### Requirement: Dashboard widget rendering honours the web app's stored configuration contract
The system SHALL read dashboards and widgets from the existing dashboard
endpoints and SHALL interpret each widget's `widget_type` and `configuration`
using the same field names and semantics the web app uses, so one stored
dashboard renders consistently on both clients. The mobile app SHALL NOT define
its own widget configuration format, and SHALL NOT write widget configuration in
Phase 1 — dashboard viewing is read-only on mobile in this change.

#### Scenario: A dashboard authored on the web is opened on mobile
- **WHEN** a dashboard containing widgets configured in the web builder is loaded
- **THEN** each supported widget reads the same `configuration` keys the web
  widget reads, and displays consistent values and units

#### Scenario: A widget type mobile does not implement is encountered
- **WHEN** a dashboard contains a `widget_type` with no mobile renderer
- **THEN** an explicit unsupported-widget placeholder naming the type is
  rendered, rather than a blank space, a crash, or a silently skipped widget

#### Scenario: The contributor is tempted to add a mobile-only config field
- **WHEN** a widget needs a value not present in the stored configuration
- **THEN** the gap is raised as a separate change against the web/API
  configuration contract, not solved by a mobile-local field

### Requirement: Live telemetry uses the device-scoped WebSocket with bounded reconnect and a polling fallback
The system SHALL subscribe to `/api/v1/ws/devices/{device_id}` with the stored
token for live device telemetry, matching the endpoint the web device-detail view
uses. Reconnection attempts SHALL be bounded and backed off rather than retried
without limit, and on exhaustion the client SHALL fall back to periodic polling
of the telemetry endpoint so a device screen continues to update. A failed
upgrade SHALL be caught and surfaced, never left as an unhandled rejection.

#### Scenario: The WebSocket upgrade fails
- **WHEN** the connection is refused or rejected
- **THEN** the failure is handled within the connection routine, the screen
  reflects a degraded-but-working state, and the app does not crash

#### Scenario: Reconnect attempts are exhausted
- **WHEN** the bounded reconnect budget is spent
- **THEN** the client switches to polling and the device screen keeps updating,
  rather than silently freezing on stale values

#### Scenario: No token is available
- **WHEN** no stored token exists
- **THEN** no WebSocket connection is attempted

#### Scenario: The screen is left
- **WHEN** the user navigates away from a device detail screen
- **THEN** the socket is closed and any polling timer cleared, so backgrounded
  screens do not hold connections open

### Requirement: Alarm acknowledge and clear go through the existing alarm endpoints
The system SHALL acknowledge and clear alarms via
`POST /api/v1/tenants/{tenant_id}/alarms/{alarm_id}/acknowledge` and
`POST .../clear`, and SHALL reflect the server's returned alarm state rather than
mutating a local copy optimistically and diverging from it.

#### Scenario: A user acknowledges an alarm
- **WHEN** acknowledge is confirmed on an alarm
- **THEN** the acknowledge endpoint is called and the list re-reads server state,
  so the mobile view and the web view cannot disagree

#### Scenario: An acknowledge request fails
- **WHEN** the endpoint returns an error
- **THEN** the alarm is shown still unacknowledged with the failure surfaced, not
  left displaying a success that did not happen

### Requirement: Out-of-scope surfaces are absent, never stubbed
The system SHALL NOT ship a screen, tab, menu entry, or navigation route for a
capability it does not implement in this change. Device commands, OTA firmware,
notifications, settings, analytics, and device visualization SHALL have no
placeholder UI, no disabled button, and no "coming soon" affordance. The app
SHALL contain no mock data, no random or synthetic values standing in for
telemetry, and no hardcoded sample entities.

#### Scenario: A capability is deferred to a later change
- **WHEN** device commands are out of Phase 1 scope
- **THEN** no commands screen or navigation entry exists at all, so the app never
  offers something it cannot do

#### Scenario: A value is not yet available from the API
- **WHEN** a screen would like a metric the API does not expose
- **THEN** the field is omitted and the gap raised as a separate change, rather
  than filled with a placeholder, a random value, or a hardcoded constant

### Requirement: The mobile app is a pure consumer of the existing platform API
The system SHALL be implementable without modifying `api/`, `web/`,
`processor/`, `shared/`, `db/`, or any migration. Work on the mobile app SHALL
NOT alter backend behaviour, add endpoints, or change database schema. Where
Phase 1 requires something the API does not expose, that requirement SHALL be
raised as its own change rather than absorbed into mobile work.

#### Scenario: A needed endpoint does not exist
- **WHEN** a mobile screen requires data no endpoint provides
- **THEN** the mobile task stops and a separate change is proposed against the
  API, rather than the API being edited from within mobile work

#### Scenario: An API response looks wrong from the mobile client
- **WHEN** an endpoint appears to misbehave
- **THEN** it is reported to the maintainer as a platform defect, and the mobile
  app does not compensate with a client-side workaround that hides it

### Requirement: `mobile/` is version-controlled
The system SHALL keep the mobile application under version control in this
repository. `mobile/` SHALL NOT be listed in `.gitignore`, and the app SHALL
NOT depend on files that exist only on one machine.

#### Scenario: A fresh clone of the repository is made
- **WHEN** the repository is cloned on a new machine
- **THEN** `mobile/` is present and the app can be installed and started from
  committed files plus documented configuration alone

#### Scenario: Secrets or machine-local configuration are needed
- **WHEN** the app needs an API host or other environment value
- **THEN** it is supplied by a gitignored env file with a committed example
  template, so the value is absent from git but its shape is documented
