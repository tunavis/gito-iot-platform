## Context

Two vendors have now been examined and they agree on the shape of the problem
while disagreeing on almost everything else.

- **B METERS** — two product lines from one vendor that share no header, no verb
  model, no acknowledgement behaviour, and no timing. `0x0A` resets an IWM and
  reads a temperature on an RFM. Transcribed from PDF manuals; four fields are
  undecodable as documented.
- **Milesight** — organised per model exactly as this change proposes, but ships
  **JavaScript** codecs, as TTN/ChirpStack vendors generally do.

Today the platform has one hardcoded dialect: `dispatch()` builds a JSON payload
before any transport is chosen, `_detect_protocol()` guesses the protocol from
device fields, the response TTL is a 60-second constant, and the lifecycle
assumes devices echo our correlation id. Uplink decoding exists
(`DeviceType.decoder`, `shared/payload_codec`) but is declarative-only and
LoRaWAN-shaped.

Constraints that shape everything below:

- **RLS is inert** under the app's database role. Any code execution added here
  runs beside every tenant's data with nothing underneath to contain it.
- **68 live meters** decode telemetry through the existing path today. Nothing
  in this change may alter that until a driver deliberately says so.
- The ChirpStack environment exists but is on another network, so end-to-end
  delivery cannot be exercised yet. Encoding and decoding can.

## The three protocol families, and which this change actually covers

The target protocol surface is large — MQTT/MQTT-SN/CoAP/HTTP/WebSockets/AMQP,
OPC UA, Modbus TCP and RTU, BACnet, KNX, DNP3, the wireless bearers from BLE and
Zigbee to LoRaWAN and NB-IoT, and the wired buses down to I²C and 1-Wire.

They are not one problem. They are three, and **this change solves one of them.**
Stating that here, because the failure mode is designing for the family in front
of us and discovering the other two as "special cases" later — which is precisely
what the acceptance criterion forbids.

### 1. Payload-oriented messaging — what this change covers

MQTT, MQTT-SN, CoAP, HTTP/HTTPS, WebSockets, AMQP; with Wi-Fi, NB-IoT, LTE-M, 5G
and LoRaWAN as bearers beneath them. The device emits a payload we decode; we
emit a payload it acts on. Both vendors examined so far live here.

The driver model fits this family exactly, and everything below is designed for
it.

### 2. Register and address-space polling — NOT covered

Modbus TCP/RTU, BACnet, DNP3, OPC UA, KNX. Also Zigbee, Z-Wave, Thread and BLE
at the application layer, where clusters, command classes and GATT
characteristics are attribute models rather than payloads.

There is no message to decode. There is an address space, and the platform
*asks*: read holding register 40001, scale ×0.1, that is flow rate — on a poll
interval, over a connection held open. A driver for this family needs a **point
map** (address, function code, type, scale, unit), a **poll cadence**, and a
**connection model**. None of those concepts exist in the declaration below.

This is why `transport` must be a genuine discriminator from day one and not an
implicit "payload" assumption. A future `"mode": "register_map"` alongside
`"mode": "payload"` is additive; retrofitting one is not.

### 3. Edge-adjacent buses — NOT covered, and not solvable from the cloud

RS232, RS485, CAN, CANopen, USB, I²C, SPI, UART, 1-Wire.

A cloud platform cannot speak I²C. These require software running physically
beside the hardware — an edge gateway or agent — which is an architecture this
change does not address and should not pretend to. It matters sooner than it
looks: **Modbus RTU rides on RS485**, so the moment a real Modbus device appears,
family 2 and family 3 arrive together.

### What that means for this change

Scope stays family 1, deliberately. Two obligations follow:

- `transport` carries an explicit interaction **mode**, so families 2 and 3 are
  additive rather than retrofitted.
- Nothing in phases 1-4 may assume "a device sends payloads" anywhere outside a
  driver. The moment that assumption leaks into dispatch, the lifecycle, or
  ingest, family 2 becomes a rewrite.

## Goals / Non-Goals

**Goals:**
- Onboarding a device family requires **data, not platform code**. This is the
  acceptance criterion; everything else is subordinate to it.
- A vendor's own codec can be used unmodified.
- The platform can state honestly what it knows about a command — including
  "delivered, and this device cannot confirm".
- Nothing that works today changes behaviour until opted in.

**Non-Goals:**
- A driver marketplace, versioning, or sharing between tenants.
- Replacing `shared/payload_codec`'s declarative decoder. It is absorbed.
- Modelling the LoRaWAN MAC layer. Receive windows are declared as constraints,
  not simulated.
- Solving OTA. `ota_dispatch` shares `_detect_protocol` and will benefit, but its
  payloads are out of scope.

## Decisions

### The driver is one JSONB column on `device_types`, nullable

`device_types.driver`. Nullable **is** the compatibility guarantee: absent means
precisely today's behaviour, so the 68 live meters are untouched until someone
writes a driver for their type.

Rejected: a separate `device_drivers` table keyed to types. It buys reuse across
types that no evidence supports — both vendors organise per model — and adds a
join to the ingest hot path.

### Shape

```jsonc
{
  "transport": {
    "mode": "payload",                  // payload | register_map | edge_gateway
                                        // Explicit from day one. This change
                                        // implements "payload" only; the other
                                        // two are additive, and an implicit
                                        // assumption here makes them rewrites.
    "protocol": "lorawan",              // authoritative; replaces guessing
    "lorawan": { "f_port": 1, "confirmed": false }
  },
  "commands": {
    "mode": "declarative",              // or "script"
    "definitions": { /* per-command opcode + field layout */ }
  },
  "telemetry": {
    "mode": "declarative",              // absorbs today's `decoder` verbatim
    "fields": [ /* existing decoder spec, unchanged */ ]
  },
  "acknowledgement": {
    "mode": "echo_opcode",              // echo_opcode | echo_frame | none
    "response_window_seconds": 43200,   // IWM reports up to 12h
    "unacknowledgeable_commands": ["reset"]
  },
  "receive_window": { "class": "A", "post_join_seconds": 120 }
}
```

`telemetry.fields` is deliberately the existing decoder spec unchanged, so
absorbing it is a move rather than a translation.

### Codecs accept two modes, and `declarative` is the default

**Declarative** — byte-layout spec, no execution. Preferred wherever it
suffices: inspectable, diffable in review, and safe by construction. B METERS
fits, since it was transcribed from a manual anyway.

**Script** — a vendor's own `*-decoder.js` / `*-encoder.js`, or a customer's
custom codec, executed as code. Zero transcription. This is what makes a new
vendor an afternoon.

Declarative is the default because the sandbox is the expensive part, which is
also why ThingsBoard defaults to TBEL over JS.

### The sandbox: requirements are fixed, the runtime is a spike

Non-negotiable, because tenant-authored code beside tenant data with inert RLS is
the whole risk:

- no filesystem, no network, no host bindings, no environment access
- hard CPU and wall-clock ceilings, hard memory ceiling
- one process per invocation or a pool that cannot carry state between tenants
- a codec is a pure function `bytes -> JSON`; it needs nothing else

Runs in the **processor**, where `shared/payload_codec` already executes, not in
the API. That keeps untrusted execution out of the process that serves
authenticated requests.

Candidates: QuickJS via Python bindings (small, embeddable, no host bindings by
default — the likeliest fit); a V8 isolate via `mini-racer`; or `node` in a
short-lived subprocess under rlimits. **I am not choosing here.** A sandbox
selected from documentation and not from a spike is exactly the kind of decision
that reads fine and fails under an adversarial input. Phase 3 opens with a spike
that runs a hostile codec — infinite loop, memory bomb, filesystem probe,
network call — against each candidate and records what actually happened.

### Acknowledgement is declared, and "cannot confirm" is a real answer

No third-party device echoes our `command_id`. IWM echoes the opcode; RFM echoes
the frame and has a NACK; some commands answer nothing at all — IWM `RESET`, RFM
`0x03 0x05`.

So correlation keys on **(device, opcode)** with at most one in flight per pair,
and `unacknowledgeable_commands` is a first-class list. A command in that list
reaches a terminal state on successful delivery, rather than waiting for a reply
that will never come.

This is the difference between a system that works and one that lies: without
it, a correctly delivered `RESET` is recorded as `timed_out`.

### Timing is per-driver, and the current constant is not a tuning value

`DEVICE_RESPONSE_TTL_SECONDS = 60` against an IWM reporting interval of up to 12
hours — NFC-settable only, so not adjustable over the air — is wrong by three
orders of magnitude. `response_window_seconds` replaces it per driver; the
constant remains only as the default for a type with no driver.

### `_detect_protocol()` reads the declaration and fails loudly

Today: `dev_eui` implies LoRaWAN, `webhook_url` implies HTTP, everything else
defaults to MQTT — and the device type's declared `connectivity.protocol` is
ignored, so a Modbus device silently gets its command published to an MQTT
channel.

New order: the driver's `transport.protocol`, then the device type's declared
protocol, then today's heuristics for types with neither. An unrecognised
protocol raises instead of defaulting. Defaulting is how a wrong answer becomes
a silent one.

### Drivers are file-defined and version-controlled, not UI-authored

Resolving the proposal's open question. A driver is a hardware integration, not
a setting: it wants review, diffs, and history. Byte offsets transcribed from a
manual are exactly the thing that should not be edited in a text box at 5pm.

The existing command *schema* editor in the device-type UI stays as it is — it
describes what a command *means* to a user (name, parameters, ranges) and belongs
in the UI. The driver describes how those bytes go on the wire. Different
audiences, different change cadence, different blast radius.

Consequence to accept: adding a vendor is a deploy, not a config change. That is
the right trade for something that can move plant, and it can be revisited once
the sandbox exists and a customer genuinely needs self-service.

## Risks / Trade-offs

- **Script execution is the largest new attack surface in this platform.** →
  Phased last, behind a spike with hostile inputs, running in the processor and
  not the API, with the declarative path preferred so most drivers never touch
  it. If the spike cannot demonstrate containment, phase 3 does not ship and the
  declarative path still delivers multi-vendor commands.
- **Absorbing `decoder` touches live telemetry for 68 meters.** → Absorption is a
  move, not a rewrite: `telemetry.fields` is the same spec, and a type with no
  driver keeps using the existing path unchanged. The phase-2 test is that
  decoding output is byte-identical before and after for every live device type.
- **Per-driver timeouts up to 12h mean commands sit pending far longer.** → They
  are already sitting that long in reality; today the platform just calls them
  failed at 60 seconds. Honest state beats convenient state. The approvals queue
  already shows pending work, so the visibility exists.
- **The IWM manual is incomplete** — four undecodable fields, and its own `0x26`
  examples are internally inconsistent. → The encoder proceeds; the decoder waits
  for the integrators' supplement B METERS offers at `ticket@bmeters.com`. Do not
  reverse-engineer byte offsets from examples the vendor got wrong.
- **A future vendor may ship neither a byte table nor JS** — a binary tool, or a
  cloud API to call. → Not designed for. The two-mode codec is an interface, so a
  third mode is additive; but if that vendor arrives before phase 3, revisit
  before building the sandbox.

## Migration Plan

Each phase ships independently and leaves the system working.

1. **Driver model, transport binding, declarative downlink encode, per-driver
   timing, unacknowledgeable terminal state.** Migration adds a nullable column.
   B METERS is the worked example. No sandbox. Commands become genuinely sendable.
2. **Acknowledgement correlation via uplink decode.** `decoder` becomes
   `driver.telemetry`. Gated on byte-identical decoding for every live type.
3. **Script codecs.** Opens with the sandbox spike; Milesight is the worked
   example, its files used unmodified.
4. **Retire `_detect_protocol` heuristics**, once every live type declares a
   transport.

**Rollback:** the column is nullable and additive, so a downgrade drops it and
every device type returns to today's path. Nothing in phases 1-2 removes an
existing mechanism before its replacement is proven.

## Open Questions

- Which sandbox runtime survives the phase-3 spike. Deliberately unanswered.
- Whether `ota_dispatch` should share the driver's transport binding. It shares
  `_detect_protocol` today, so it inherits the fix for free, but its payload
  format is its own problem and is out of scope here.
