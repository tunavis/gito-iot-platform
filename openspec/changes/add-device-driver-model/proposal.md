## Why

The platform's purpose is multi-vendor, multi-device, multi-protocol
integration. That is the bar Cumulocity, ThingsBoard and AWS IoT already meet,
and each meets it the same way: **how to speak to a device is data, not code.**
ThingsBoard has transport layers and device profiles; Cumulocity has device
protocols and SmartREST templates.

We treat it as code, with one hardcoded dialect. `CommandDispatchService.dispatch()`
builds a single payload before any transport is chosen —

```python
payload = {"type": "command", "command_id": ..., "command": ..., "parameters": {...}}
```

— and every transport serialises that same dict. A device built for this
platform's own convention works. **No third-party device does, on any protocol.**

### The evidence, and why it is stronger than it looks

B METERS appears throughout this proposal as evidence, not as its subject. It is
unusually good evidence because **one vendor's own two product lines share
nothing**:

| | IWM-LR3/LR4 | RFM-LR1 |
|---|---|---|
| Header | 5 bytes (`Fct, C/R/A, Err, Chain, Len`) | 2 bytes (`Type, Index`) |
| Verb | baked into the opcode | explicit Set/Query/Action over a shared index space |
| Acknowledgement | echoes the opcode with `C/R/A=0x01` | echoes the full frame; has a real NACK |
| Reporting interval | up to **12 hours**, NFC-settable only | default 4 hours |
| `0x0A` means | reset the microcontroller | read CPU temperature |

That last row is the whole argument. A flat opcode table is not merely untidy,
it is dangerous. If a single vendor's catalogue cannot share a codec, no global
table can — so the unit of declaration must be the **device type**, and this has
to be settled before a second vendor arrives rather than retrofitted after.

### Why a driver, and not just a command codec

An earlier draft of this change covered downlink encoding only. That is not
shippable, for a structural reason: **the acknowledgement to a command arrives as
an uplink.** IWM echoes the opcode; RFM echoes the frame. "Did my command land"
is unanswerable without the uplink decoder, so a downlink-only change produces a
system that sends bytes correctly and then marks every command `timed_out` — the
exact defect that motivated the work.

`DeviceType.decoder` already exists for uplinks and is LoRaWAN-shaped. Adding a
separate downlink column would give one device two wire-format declarations, in
two schemas, that drift — and force whoever integrates the next vendor to learn
both. They are one concern.

## What Changes

A **device driver**: one declarative, per-device-type description of how the
platform speaks to a class of hardware, covering

- **transport binding** — which protocol, and its parameters (LoRaWAN port and
  confirmed flag, MQTT topic, HTTP shape). Replaces guessing.
- **downlink encoding** — command name and parameters to bytes.
- **uplink decoding** — bytes to metrics. **Absorbs the existing `decoder`**,
  which becomes the uplink half of a driver rather than a separate mechanism.
- **acknowledgement semantics** — how a device confirms, if it can at all.
  `unacknowledgeable` must be a first-class, honest option: IWM `RESET` and RFM
  `0x03 0x05` never answer, and today they would hang pending forever.
- **timing** — expected response window and any receive-window constraint.

Plus the consequences:

- **`_detect_protocol()` stops guessing.** It infers LoRaWAN from `dev_eui`,
  HTTP from a `webhook_url`, and otherwise defaults to MQTT, ignoring the device
  type's declared protocol entirely. An unknown protocol must fail loudly, not
  fall through to MQTT.
- **`DEVICE_RESPONSE_TTL_SECONDS = 60` becomes per-driver.** An IWM meter reports
  on up to a 12-hour interval that cannot be changed over the air. Sixty seconds
  is not a tuning mistake, it is off by three orders of magnitude for hardware
  already deployed. *(Latent rather than live: no device type currently enables
  the `commands` capability, so nothing can be sent yet. It becomes wrong the
  moment one does.)*
- **The lifecycle gains an honest terminal state** for devices that cannot
  acknowledge, so a delivered command is not recorded as a failure.

## The test this change has to pass

**Adding a vendor must require no platform code.** If integrating the next
device family means writing a `_dispatch_x` branch, a parser, or a lifecycle
special case, this change has failed regardless of how well it works for
B METERS. The acceptance criterion is a new device type onboarded by declaration
alone.

## Phasing

Sequenced so each phase ships independently and nothing live breaks. The
existing `decoder` is **absorbed, never replaced** — today's behaviour stays the
default, so telemetry decoding for 68 live meters is untouched until a driver
explicitly overrides it.

1. **Driver model + transport binding + downlink encode + per-driver timing +
   the unacknowledgeable terminal state.** Commands become genuinely sendable to
   fire-and-forget hardware, and the 60-second lie is gone.
2. **Acknowledgement correlation through uplink decode.** The existing `decoder`
   becomes a driver's uplink half. Correlation keys on *(device, opcode)* with at
   most one in flight per pair, because no third-party device echoes our id.
3. **Retire the `_detect_protocol` heuristics** in favour of the declared
   transport, once every live device type declares one.

## Capabilities

### New Capabilities
- `device-drivers`: what a device type declares about how it is spoken to —
  transport, encoding, decoding, acknowledgement and timing — and the guarantee
  that onboarding hardware requires data rather than code.

### Modified Capabilities
- `integrations-and-commands`: dispatch resolves a driver before choosing a
  transport; protocol detection consults the declaration; an unsupported protocol
  fails instead of defaulting; command lifecycle admits devices that cannot
  acknowledge.
- `telemetry-ingestion`: the uplink decoder becomes part of a driver rather than
  a standalone column.

## Impact

**Database** — a driver declaration on `device_types` (JSONB, nullable).
Nullable is the compatibility guarantee: absent means exactly today's behaviour.

**Services** — `command_dispatch.py`, `ota_dispatch.py` (`_detect_protocol` is
shared), `shared/payload_codec`, and the telemetry ingest path where `decoder`
is applied today.

**Not blocked by ChirpStack reachability.** The ChirpStack environment exists on
another network. Encoding and decoding are unit-testable against expected bytes
with no network server at all; only a final end-to-end needs the connection.

## Open Questions

- The IWM decoder should wait for the integrators' supplement the manual itself
  points to (`ticket@bmeters.com`). Four items are undecodable as documented —
  alarm date packing has no worked example, and `0x17`'s stated length
  contradicts its own byte table. The **encoder can proceed now**; see
  `research/b-meters-commands.md`.
- Should drivers be authorable in the device-type UI, or file-defined and
  version-controlled? File-defined is likelier right for something that is
  effectively a hardware integration, but the command *schema* editor already
  exists in the UI and the boundary between them needs drawing.
