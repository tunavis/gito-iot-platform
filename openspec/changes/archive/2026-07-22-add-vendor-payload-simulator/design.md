## Context

Two ingestion shapes already exist and must both be simulated realistically:

1. **Native platform MQTT/HTTP** — a device (or `simulator.py` today) publishes flat
   JSON to `{tenant_id}/devices/{device_id}/telemetry` on the local Mosquitto
   broker; `mqtt_processor.py` subscribes to `+/devices/+/telemetry` and stores it
   more or less as-is (through `key_mapping` rename only, no byte decoding).
2. **ChirpStack LoRaWAN bridge** — `mqtt_processor.py` runs a `ChirpStackBridgeManager`
   that connects *outbound* to the real remote ChirpStack broker
   (`mqtt.cordys.co.za`) per registered integration, and relays what it receives
   onto the **local** Mosquitto broker under the same ChirpStack-shaped topic
   (`application/+/device/+/event/up`), which the processor also subscribes to
   locally. This is the path `payload_codec.decode()` and the NS-vs-declarative
   selection logic (`processor/mqtt_processor.py`, the `NS_PLACEHOLDER_KEYS` fix
   from this session) actually run on in production.

`simulation_data/mqtt/simulator.py` today only speaks shape (1), with four
hardcoded category profiles, and writes plausible-looking numbers with no
relationship to any device type's real schema or byte layout.

## Goals / Non-Goals

**Goals:**
- Simulate shape (2) with enough fidelity that a decoder bug or a processor
  regression in the NS/declarative selection logic would be caught by replaying
  a fixture, not just by real hardware.
- Make adding simulation support for a new vendor preset a side effect of
  authoring the preset's normal `dataModel`/`decoderFields` (plus an optional
  hint), not a second parallel implementation task.
- Keep `payload_codec` a single, still-declarative, still-no-code-execution
  module — `encode()` lives next to `decode()`, same contract.
- Structure protocol support so `mqtt` and `lorawan` are the first two
  registrations, not the only two possible ones.
- Make the tool look like it belongs to Gito.

**Non-Goals:**
- Shipping `http`/`modbus`/`opcua`/`coap`/`zigbee`/`nbiot` publishers in this
  change — the registry makes them cheap later, but only `mqtt` and `lorawan`
  are built now.
- Inventing a new visual identity for the tool — the UI rebuild reuses the
  app's existing tokens exactly (see Decisions), not a fresh design exercise.
- Simulating non-ChirpStack LoRaWAN providers (TTN, generic webhook shapes) —
  out of scope; this platform's only LoRaWAN traffic today is the ChirpStack
  bridge.
- Radio-layer realism (RSSI/SNR distributions, gateway timing) — plausible
  constants/ranges are enough; nothing downstream depends on their statistics.
- A UI for the simulator — stays a CLI tool, consistent with `simulator.py`
  today and `bridge_ui.py` being the only tool that has a UI (because it needs
  interactive topic browsing, which a fixture replay doesn't).
- Ever publishing to the real remote ChirpStack broker — see Risks.

## Decisions

**Protocol support is a publisher registry, not a growing if/elif chain.**
`{"mqtt": MqttNativePublisher(), "lorawan": LoRaWANPublisher()}`, keyed by the
device type's `connectivity.protocol` — the exact field the app already stores
per device type. Each publisher implements one method:
`publish_uplink(device, device_type, values: dict[str, Any]) -> None`. The
synthetic-value generator (data_model → values dict) is shared and protocol-
agnostic; only the "how do these values become wire bytes for this protocol"
step is per-publisher. Adding `http` later (POST to the device-token `/ingest`
endpoint — the REST entry point `telemetry-ingestion` already documents) or
`modbus`/`opcua`/`coap`/`zigbee`/`nbiot` means writing one new class and adding
one registry entry; nothing else in the simulator changes. Alternative
considered: special-case LoRaWAN inside the existing single publish function
(smallest immediate diff). Rejected — that's how the current four-hardcoded-
categories design happened in the first place, and the user has explicitly
asked for more protocols beyond these first two, so building the seam now costs
little and avoids a second rewrite.

**Simulator UI is rebuilt on the app's actual design tokens, not a fresh style.**
`bridge_ui.py`'s `templates/index.html` currently hand-rolls its own dark
palette + emoji icons via Tailwind-CDN utility classes, unrelated to
`web/src/app/globals.css`. Alternative considered: leave the visual style as-is
and only add new controls for protocol/fixture selection. Rejected per explicit
feedback — the tool should read as part of Gito, not a separate script. The
fix is mechanical, not a new design: copy the real custom-property values
(`--color-primary`, `--color-surface`/`--color-panel`/`--color-border`,
`--hmi-status-ok`/`-warn`/`-alarm`, and the light/dark pairs) into this
template's `<style>` block — Alpine.js and a static HTML page can't `import` the
Next.js CSS module, but the token *values* are just hex strings and can be
duplicated verbatim — and replace emoji status indicators with a small inline
SVG icon set in the same style Lucide icons render in the app (stroke-based,
`currentColor`), rather than introducing a build step or CDN dependency this
tool doesn't otherwise have.

**Publish target: local Mosquitto, ChirpStack-shaped topic — never the remote broker.**
The simulator (like `simulator.py` today) only ever has credentials for and
connects to local Mosquitto. To simulate a ChirpStack uplink, it publishes the
synthetic envelope directly onto the **local** `application/{app_id}/device/
{dev_eui}/event/up` topic — exactly the topic the real bridge relays real
uplinks onto locally. The processor's local subscriber can't distinguish a
relayed-real message from a directly-published-synthetic one, which is what
gives this its fidelity. This also means the simulator never touches
`mqtt.cordys.co.za` even indirectly — it doesn't go anywhere near the outbound
bridge connection at all.

**`encode()` lives in `payload_codec.engine`, mirrors `decode()` field-by-field.**
Alternative considered: a separate "fixture generator" module outside
`payload_codec` that hand-assembles bytes per known device type. Rejected —
that's exactly the one-off-script pattern this change replaces; it would drift
from the decoder spec the same way a hand-written validation script already can.
Keeping `encode()` in the same module against the same spec format guarantees
a fixture is only as correct as the decoder itself, which is the property we
want (round-trip test, not independent reimplementation).

**Value generation is `data_model`-driven with an optional preset-level override.**
Alternative considered: keep category-based profiles but add more categories.
Rejected — category is a UI grouping (8 broad buckets), not a schema; two
"meter" device types can have completely different fields (energy vs. water
flow), so category can never be a reliable source of what fields to generate.
The device type's own `data_model` is the one place that's always correct,
since it's exactly what a real decode (or real JSON payload) is supposed to
produce.

**Fixture mode is a CLI flag on the existing simulator, not a new binary.**
`simulator.py --fixture <device-type-id> [--count N]` reuses the existing DB
connection, config loading, and MQTT publish code; it just skips the
poll-interval loop and device-discovery lifecycle for a single immediate run.
Avoids a second tool with its own config/connection-handling to keep in sync.

## Risks / Trade-offs

- **[Risk] A future edit accidentally points the simulator at the remote
  ChirpStack broker instead of local Mosquitto** → Mitigation: the simulator's
  MQTT client config for this mode should only ever read `mqtt.local.*` from
  `config.yaml` (same section `simulator.py` already uses today); the
  remote-broker credentials aren't available to the simulator process at all,
  the same way they aren't today.
- **[Risk] `encode()` masks a decoder bug that happens to be symmetric** (e.g. an
  offset that's wrong in both directions consistently) → Mitigation: round-trip
  testing catches *inconsistency*, not an absolute-correctness guarantee. The
  existing practice of validating against real captured hex (as was done for
  RFM-LR1) remains the authority for a *new* decoder's correctness; fixture
  replay is the repeatable regression check afterward, not a replacement for
  that first validation.
- **[Risk] BCD/scale fields can't represent every value exactly** (e.g. a value
  requiring more precision than the field's digit count) → Mitigation:
  `encode()` should raise rather than silently truncate/wrap, so a fixture
  generator asking for an out-of-range value fails loudly instead of producing
  a misleading round-trip.

## Migration Plan

Purely additive — no API, database, or production deploy surface. `encode()` is
a new function alongside existing `decode()` exports; the simulator changes are
confined to `simulation_data/mqtt/` (a dev/test tool, not shipped in the
`api`/`web`/`processor` images). No rollback plan needed beyond reverting the
commits; nothing here is reachable from production code paths.

## Open Questions

- Should adding a new vendor preset be *required* (a checked convention, maybe
  enforced by a test) to include a fixture proof, or stay optional/best-effort
  the way `simulationProfile` itself is optional? Leaning optional-but-encouraged
  for now — deferring to the tasks phase / first real usage to decide whether
  friction is worth the guarantee.
