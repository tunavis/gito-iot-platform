## Why

Every new vendor decoder — most recently the B METERS RFM-LR1 work — is currently
proven correct by hand: a one-off Python script decodes hex bytes copy-pasted from
real captured uplinks, gets run once in a scratch directory, and is thrown away.
There is no repeatable way to generate a synthetic-but-valid raw payload for a
device type and replay it through the actual ingestion pipeline, so a wrong byte
offset, a decoder that silently returns `{}`, or a pipeline regression (like the
NS-placeholder-keys bug found and fixed this session, where the processor trusted
ChirpStack's own empty codec output over our declarative decoder) isn't caught
until a real device is on-site sending real traffic. `simulation_data/mqtt/
simulator.py` already exists and publishes synthetic telemetry, but only as
pre-decoded flat JSON on four hardcoded category profiles — it never touches
`payload_codec` or the LoRaWAN ingest path, so it can't exercise a decoder at all,
and it can't represent a new vendor's device shape without editing simulator code
by hand.

## What Changes

- New `payload_codec.encode()` — the inverse of the existing `decode()`: given a
  decoder spec (the same JSON already stored on `device_types.decoder`) and a
  dict of target metric values, produce the raw payload bytes. Reuses the same
  field-type/endian/scale/bit logic `decode()` already implements (uint8-32,
  int8-32, float32, bcd, bit-within-byte, `scale_exponent_ref`/`base`), so a
  fixture is guaranteed to round-trip (`decode(spec, encode(spec, values)) ==
  values`) rather than being hand-derived and possibly wrong in a different way
  than the decoder itself.
- The simulator is restructured around a **pluggable protocol publisher**: one
  small interface (`publish_uplink(device, device_type, values)`), one
  implementation per wire protocol, selected by the device type's own
  `connectivity.protocol` — the same field the app already stores
  (`lorawan`/`mqtt`/`http`/`modbus`/`opcua`/`coap`/`zigbee`/`nbiot`, per
  `PROTOCOL_META` in `devices/new/page.tsx`). This change ships two publishers;
  the point of the abstraction is that a third doesn't touch the other two:
  - **`mqtt` (native)**: today's flat-JSON-on-`{tenant}/devices/{id}/telemetry`
    path, kept, but rebuilt to generate values from the device type's own
    `data_model` instead of the current four hardcoded category profiles
    (`sensor`/`gateway`/`meter`/`tracker`), so it covers any device type.
  - **`lorawan`**: new. Builds synthetic metric values from `data_model`,
    encodes them via `payload_codec.encode()`, wraps them in a synthetic
    ChirpStack uplink envelope (`data` base64, `fPort`, `deviceInfo.devEui`),
    and publishes to the exact MQTT topic (`application/+/device/+/event/up`)
    the processor already subscribes to for real ChirpStack uplinks. A
    simulated device goes through dedup, rate-limiting, NS-vs-declarative
    decode selection, `raw_uplinks` capture, alarm evaluation, and WebSocket
    delivery identically to a real device — "as if it was a real device" all
    the way through, not a shortcut that writes telemetry rows directly.
  - Every other protocol the platform already recognizes (`http`, `modbus`,
    `opcua`, `coap`, `zigbee`, `nbiot`) is explicitly out of scope for this
    change but requires no rework of the shared value-generation layer or the
    device-discovery loop to add later — only a new publisher.
- The synthetic-value generator (shared by every publisher) is `data_model`-driven:
  type/unit/min_value/max_value per field, not a hardcoded category list.
- Optional per-vendor-preset `simulationProfile` (declares which fields drift,
  monotonically increase, slowly drain, or are rare-true alarm bits, plus
  realistic ranges) so a new preset can describe believable behavior — e.g. an
  RFM-LR1 preset would mark `total_volume` as a slow monotonic counter and the
  alarm bits as rare. A generic default (numeric fields drift inside
  min_value/max_value if present, boolean fields are rarely true) applies when a
  preset doesn't define one, so simulation works out of the box for every device
  type with zero extra authoring required — the profile is an enhancement, not a
  prerequisite.
- A `--fixture <device-type-id-or-preset-id>` simulator mode: publish N synthetic
  uplinks for one device type immediately instead of waiting out the poll
  interval. This is the direct, repeatable replacement for the one-off validation
  scripts written by hand this session, and becomes the standard "does this
  decoder actually work" check for every future vendor preset.
- **BREAKING (tool UI, not the platform)**: `bridge_ui.py`'s web UI
  (`templates/index.html`) is redesigned to look like the actual app instead of
  its own dark-terminal/emoji-icon aesthetic. It currently ships its own
  hand-rolled dark palette, Tailwind-via-CDN utility classes, and emoji as
  status icons — visually unrelated to the Next.js dashboard. The rebuild reuses
  the app's real design tokens (`web/src/app/globals.css` custom properties:
  `--color-primary` #2563eb, `--color-surface`/`--color-panel`/`--color-border`,
  `--hmi-status-ok`/`-warn`/`-alarm`, light-first with the same dark-mode
  variables) and a consistent icon set instead of emoji, so this tool reads as
  part of Gito rather than a separate hacked-together script. The simulator's
  new protocol/fixture controls are added to this same UI rather than bolted on
  as a second interface.

Kept in scope for this same change (not split out) because it's the same tool
gaining new capability — the visual rebuild and the protocol/fixture work touch
the same file and are easier to land together than to sequence.

## Capabilities

### New Capabilities
- `device-simulation`: synthetic device traffic, generated from a device type's
  own schema and replayed through the real ingestion pipeline via a pluggable
  per-protocol publisher (native MQTT and LoRaWAN first), for testing
  dashboards, alerts, and — critically — proving a new vendor decoder end-to-end
  without real hardware. Includes the tool's own UI, redesigned to match the
  app's visual identity.

### Modified Capabilities
(none — `payload_codec.decode()`'s existing behavior is unchanged; `encode()` is
new surface area, not a change to a documented requirement)

## Impact

- `shared/payload_codec/payload_codec/engine.py` — add `encode()`;
  `shared/payload_codec/tests/` — round-trip tests per field type.
- `simulation_data/mqtt/simulator.py`, `config.yaml`, `README.md` — protocol
  publisher registry (`mqtt`, `lorawan`), `data_model`-driven value generation,
  `--fixture` flag.
- `simulation_data/mqtt/bridge_ui.py`, `templates/index.html` — visual rebuild
  onto the app's design tokens; new controls for protocol/fixture simulation
  alongside the existing external-broker-bridging workflow.
- `web/src/app/dashboard/device-types/_vendorPresets.ts` — optional
  `simulationProfile` on `VendorPreset` (additive, no existing preset breaks).
- No API or database schema changes. The simulator reads `devices`/`device_types`
  from Postgres and calls the existing device-types API exactly as it does today;
  it publishes to the same local Mosquitto broker and topics the processor
  already consumes in production, so `mqtt_processor.py` needs no changes.
