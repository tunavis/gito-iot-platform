## ADDED Requirements

### Requirement: Simulation is restricted to devices tagged 'simulated'
The system SHALL scope every device query the simulator uses — both continuous
(poll-interval) simulation and fixture-replay mode — to devices whose `tags`
array contains `"simulated"`. This filter SHALL live in the query the simulator
itself issues, not only in a UI-layer check, so no invocation path (CLI, the
Bridge UI, or code that imports the simulator directly) can bypass it.

#### Scenario: A real device shares a type with a simulator device
- **WHEN** a device type has both a real, currently-reporting device and a
  simulator-created device
- **THEN** continuous simulation and fixture mode only ever consider the
  simulator-created (tagged) device; the real device is never selected,
  regardless of its status or how long ago it last reported

#### Scenario: No simulator device exists yet for a type
- **WHEN** fixture mode is invoked for a device type with no tagged device
- **THEN** it fails with a clear message directing the caller to create one —
  it never falls back to an untagged device of that type

### Requirement: Simulator devices are created only through a dedicated endpoint
The system SHALL provide `POST /api/simulator/create-device` as the only
supported way to obtain a device the simulator may use. It SHALL create the
device via the same device-creation API path a real device uses, additionally
setting `tags: ["simulated"]`, and SHALL auto-generate a unique `dev_eui` for
LoRaWAN-protocol device types (retrying on the rare uniqueness collision rather
than requiring the caller to supply one).

#### Scenario: Creating a simulator device for a LoRaWAN type
- **WHEN** `create-device` is called with a `device_type_id` whose
  `connectivity.protocol` is `lorawan`
- **THEN** the created device has a random 16-hex-character `dev_eui` that does
  not collide with any existing device in the tenant, and is tagged `simulated`

### Requirement: Deleting a simulator device is refused unless it is tagged
The system SHALL refuse (HTTP 403) any request to delete a device through
`POST /api/simulator/delete-device` unless that device's `tags` include
`"simulated"` — regardless of the caller's intent.

#### Scenario: Attempting to delete an untagged device through this endpoint
- **WHEN** `delete-device` is called with the ID of a device that is not
  tagged `simulated`
- **THEN** the request is refused with a 403 and no deletion occurs

### Requirement: The Bridge UI provides a guided simulator-device workflow
The system SHALL present a panel ("Simulator Devices") that, for a selected
device type: lists existing simulator devices for that type with per-device
"send test data" and "delete" actions, and offers to create a new one with an
optional name (auto-generated when omitted). This SHALL be the only simulator
device management surface in the UI — fixture mode is not otherwise exposed
without first selecting or creating a device through this panel.

#### Scenario: First time testing a new vendor preset
- **WHEN** a user selects a device type with no existing simulator devices
- **THEN** the panel shows "None yet — create one below" and offers the create
  action; no send/delete controls are shown until a device exists

### Requirement: The Gito connection URL is detected automatically
The system SHALL provide `GET /api/detect-gito-url`, which probes a short list
of candidate local URLs (the configured default plus common alternates) against
each candidate's `/api/health` endpoint server-side, and returns the first one
that responds successfully. The Bridge UI SHALL pre-fill the login form's URL
field with this result on page load, rather than only the static config default.

#### Scenario: The configured default port is wrong for this environment
- **WHEN** `config.yaml`'s `gito_api_url` does not respond, but an alternate
  candidate (e.g. a different local port) does
- **THEN** the login form pre-fills with the working alternate, not the
  non-responding configured default
