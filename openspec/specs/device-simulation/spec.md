# device-simulation Specification

## Purpose
TBD - created by archiving change add-vendor-payload-simulator. Update Purpose after archive.
## Requirements
### Requirement: payload_codec provides an encode() that round-trips with decode()
The system SHALL provide `payload_codec.encode(decoder_spec, values: dict) -> bytes`
that produces a raw payload from a dict of metric values, using the same decoder
spec format already stored on `device_types.decoder` (offset, length, type,
endian, scale, bit, scale_exponent_ref/scale_exponent_base). For every field type
`decode()` supports (`uint8`/`16`/`32`, `int8`/`16`/`32`, `float32`, `bcd`, and a
`bit`-within-a-byte flag), `decode(spec, encode(spec, values))` SHALL reproduce
`values` (within the field's own rounding — e.g. a `scale` that loses precision
is expected to round-trip to the scaled value, not bit-for-bit). Multiple `bit`
fields sharing the same `offset` SHALL be OR'd into that single byte rather than
overwriting one another.

#### Scenario: Round-tripping a multi-field decoder spec
- **WHEN** `encode()` is called with the RFM-LR1 decoder spec and
  `{"total_volume": 497782, "removal_alarm": True}` (all other alarm bits absent/False)
- **THEN** the returned bytes, passed back through `decode()` with the same spec,
  yield `{"total_volume": 497782.0, "removal_alarm": 1.0, "flow_exceeds_q3_alarm": 0.0,
  "magnetic_fraud_alarm": 0.0, "leakage_alarm": 0.0}`

#### Scenario: BCD field with VIF-style overflow scaling
- **WHEN** `encode()` is called with the IWM-LR3/LR4 decoder spec and a
  `total_volume` value that requires a non-zero `vif_code` to represent (i.e. it
  exceeds the 8-digit BCD field's plain-litres range)
- **THEN** the encoded `vif_code` byte and BCD digits, decoded back through
  `decode()`, reproduce the original `total_volume` within the field's scale step

### Requirement: Protocol support is a pluggable publisher, not built-in special-casing
The system SHALL select how to publish a simulated device's synthetic values by
looking up its device type's `connectivity.protocol` in a publisher registry,
where each entry implements the same `publish_uplink(device, device_type,
values)` contract. This change SHALL register exactly two publishers —
`mqtt` (native flat-JSON) and `lorawan` (raw-payload/ChirpStack) — but adding a
publisher for any other protocol the platform already recognizes
(`http`, `modbus`, `opcua`, `coap`, `zigbee`, `nbiot`) SHALL require only a new
class and a new registry entry, with no change to the synthetic-value generator
or the device-discovery/lifecycle loop.

#### Scenario: A device type using an unregistered protocol
- **WHEN** a device type's `connectivity.protocol` has no registered publisher
  (e.g. `modbus`, not yet built)
- **THEN** the simulator skips that device with a clear log message identifying
  the missing protocol, rather than crashing the whole simulation loop or
  silently guessing a different protocol's wire format

### Requirement: LoRaWAN device types simulate through the real ChirpStack ingest path, not a shortcut
For a device type with a non-null `decoder`, the system SHALL generate synthetic
metric values, encode them via `payload_codec.encode()`, and publish a synthetic
ChirpStack uplink envelope (`data`: base64 of the encoded bytes, `fPort` matching
the decoder's `f_port`, `deviceInfo.devEui` matching the simulated device) to the
same MQTT topic (`application/+/device/+/event/up`) the processor subscribes to
for real ChirpStack uplinks in production. The system SHALL NOT write directly to
`raw_uplinks` or `telemetry` tables to simulate a LoRaWAN device.

#### Scenario: Simulated RFM-LR1 uplink
- **WHEN** the simulator generates an uplink for a device of type "B METERS RFM-LR1"
- **THEN** `mqtt_processor.py` receives it on the ChirpStack topic exactly as it
  would a real uplink, resolves the dev_eui, decodes it via the device type's
  declarative decoder (since the synthetic envelope carries no NS `object`),
  writes a `raw_uplinks` row and `telemetry` rows, and evaluates alarm rules —
  with no code path distinguishing a simulated uplink from a real one

#### Scenario: Envelope omits the NS object field
- **WHEN** the simulator builds the synthetic ChirpStack envelope
- **THEN** it omits `object` (or provides only placeholder keys covered by
  `NS_PLACEHOLDER_KEYS`) so the processor falls through to the device type's own
  declarative decoder — matching how a real device with no NS-side codec behaves

### Requirement: Synthetic values are derived from the device type's own data_model
For both the raw-payload (LoRaWAN) and flat-JSON (MQTT/HTTP) simulation paths, the
system SHALL generate each metric's synthetic value from that field's entry in
the device type's `data_model` (`type`, `unit`, `min_value`, `max_value`) rather
than a hardcoded per-category profile table. A numeric field with both
`min_value` and `max_value` set SHALL be generated within that range; a numeric
field without bounds SHALL fall back to a generic reasonable default range for
its `type`. A `boolean` field SHALL default to rarely true (simulating an alarm
condition that is normally clear).

#### Scenario: Device type not covered by the old hardcoded categories
- **WHEN** a device type has `category: "meter"` but a `data_model` wholly
  different from the built-in energy-meter profile (e.g. a water flow meter with
  `total_volume`/`reverse_volume`/alarm bits)
- **THEN** the simulator generates values for exactly the fields declared in that
  device type's own `data_model`, not the generic meter profile's
  `energy_kwh`/`power_w`/`voltage`

### Requirement: A vendor preset may declare a simulationProfile; a generic default applies when absent
The system SHALL allow a `VendorPreset` to optionally declare a
`simulationProfile` describing, per field, whether it drifts (random walk within
range), monotonically increases (a cumulative counter), slowly drains (e.g.
battery), or is a rare-true alarm bit, plus a realistic value range. When a
device type's originating preset (or the device type itself) has no
`simulationProfile`, the system SHALL apply the generic data_model-driven
defaults from the previous requirement — a `simulationProfile` is an enhancement,
never a prerequisite for a device type to be simulatable.

#### Scenario: Preset with a simulation profile
- **WHEN** the RFM-LR1 preset declares `total_volume` as a monotonic counter and
  its alarm bits as rare-true
- **THEN** simulated RFM-LR1 devices show `total_volume` increasing across
  successive uplinks and alarm bits that are almost always 0

#### Scenario: Preset without a simulation profile
- **WHEN** a newly-added vendor preset defines only `dataModel`/`decoderFields`
  and no `simulationProfile`
- **THEN** the simulator still produces plausible synthetic uplinks for it using
  the generic per-type defaults, with no error and no additional authoring
  required before it can be simulated

### Requirement: A one-shot fixture-replay mode proves a decoder without waiting on the poll interval
The system SHALL support invoking the simulator for a single device type
(`--fixture <device-type-id>`) to publish N synthetic uplinks immediately and
exit, independent of the standard poll-interval device-discovery loop, so
validating a newly-authored decoder is a repeatable command rather than a
one-off hand-written script.

#### Scenario: Proving a new vendor decoder
- **WHEN** a developer runs the simulator in fixture mode against a device type
  whose decoder was just authored
- **THEN** the tool publishes synthetic uplinks through the real ingest path (per
  the LoRaWAN or flat-JSON requirement above, as applicable) and the resulting
  `telemetry` rows for that device can be inspected to confirm the decoder
  produces the expected fields — without any real hardware and without a
  hand-written throwaway script

### Requirement: The simulator's web UI uses the app's own design tokens, not its own visual style
The system SHALL style `bridge_ui.py`'s web UI using the same color tokens
`web/src/app/globals.css` defines (`--color-primary`, `--color-surface`,
`--color-panel`, `--color-border`, `--hmi-status-ok`/`-warn`/`-alarm`, and their
dark-mode pairs), light-first with dark-mode support matching the app, and a
consistent stroke-based icon set in place of emoji status indicators. New
controls for protocol selection and fixture-mode replay SHALL be added to this
same page rather than a second tool or a separate page.

#### Scenario: Opening the simulator UI next to the app
- **WHEN** a developer has the Gito dashboard open in one tab and the simulator
  UI open in another
- **THEN** the two share the same color palette, status-color meaning (green
  ok / amber warn / red alarm), and icon style, rather than the simulator
  reading as an unrelated dark-terminal script

#### Scenario: Triggering a fixture replay from the UI
- **WHEN** a developer selects a device type and clicks "Send test uplinks" in
  the simulator UI
- **THEN** the same `--fixture` codepath described above runs, and the UI shows
  the resulting synthetic payload and decoded metrics the way the "Topics"
  panel already shows real bridged traffic

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

