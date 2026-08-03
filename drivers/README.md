# Device drivers

One JSON file per device type, describing how the platform speaks to that
hardware: transport binding, downlink command encoding, acknowledgement
semantics and timing. The schema, and the validation every file here must pass,
live in `shared/payload_codec/payload_codec/driver.py` — in the shared package
rather than the API because the **processor** reads drivers too, for uplink
decoding and acknowledgement correlation. A second copy would be two readers of
one declaration format, free to drift.

**These are files, not settings.** A driver is a hardware integration
transcribed from a vendor manual — byte offsets that want review, diffs and
history, not a text box at 5pm. Adding a vendor is therefore a deploy. The
device-type UI's *command schema* editor is a different thing and stays where it
is: it describes what a command means to a user (name, parameters, ranges),
while a driver describes how those bytes go on the wire.

To apply one, PUT it as the `driver` field of a device type:

```
PUT /api/v1/tenants/{tenant_id}/device-types/{device_type_id}
{"driver": <contents of the file>}
```

A malformed driver is refused there with the reason, so a wrong offset fails on
save rather than at dispatch.

## Absent means today's behaviour

A device type with no driver dispatches, decodes and times out exactly as it did
before drivers existed. That is the compatibility guarantee for the live fleet,
not an unconfigured state — so there is no obligation to write a driver for a
device type that already works.

## The files

| File | Device type | Evidence |
|---|---|---|
| `b-meters-iwm-lr3-lr4.json` | B METERS IWM-LR3 / IWM-LR4 water meter | `openspec/changes/add-device-driver-model/research/b-meters-commands.md` §1 |
| `b-meters-rfm-lr1.json` | B METERS RFM-LR1 module for GSD8-RFM | same, §2 |

Both were transcribed from the vendor PDFs in `docs/`. The RFM manual's seven
worked examples all decode cleanly and are asserted in
`api/tests/test_device_driver.py`; the IWM's `0x26` examples are internally
inconsistent (one encodes a 33,685,504 mV battery threshold against a documented
2200 mV default) and are deliberately **not** used as fixtures.

Note what the two files demonstrate together: they share no header, no verb
model, no acknowledgement behaviour and no timing, and byte `0x0A` resets one
while reading a temperature on the other. They are one vendor's own two product
lines. That is why the unit of declaration is the device type.

## How to write one

### 1. Transport

```jsonc
"transport": {
  "mode": "payload",        // payload | register_map | edge_gateway
  "protocol": "lorawan",    // lorawan | mqtt | http
  "lorawan": {"f_port": 1, "confirmed": false},
  "mqtt": {"topic": "..."}  // optional; {tenant_id}/{device_id} are substituted
}
```

`mode` is required and explicit. Only `payload` is implemented — the other two
are **refused on save**, not silently treated as `payload`. That matters because
a register/address-space protocol (Modbus, BACnet, OPC UA, KNX, DNP3, and
Zigbee/Z-Wave/BLE at the application layer) has no message to encode at all: it
needs a point map, a poll cadence and a connection model, none of which this
declaration can express. Rejecting it now is what keeps that family additive
rather than a rewrite.

`transport.protocol` is authoritative. It beats the device type's
`connectivity.protocol`, which beats the old field heuristics. A protocol with
no dispatch path raises rather than falling through to MQTT.

### 2. Commands

A command definition is a list of `payload_codec` field specs plus a `constants`
map giving the fixed ones their values:

```jsonc
"set_reporting_interval": {
  "constants": {"type": 1, "index": 34},
  "fields": [
    {"name": "type",    "offset": 0, "length": 1, "type": "uint8"},
    {"name": "index",   "offset": 1, "length": 1, "type": "uint8"},
    {"name": "minutes", "offset": 2, "length": 2, "type": "uint16", "endian": "big"}
  ]
}
```

A header is not a special mechanism — it is fields at offsets 0..n whose values
happen to be fixed — so the IWM's 5-byte header and the RFM's 2-byte header are
the same code with different declarations, and a third vendor with a third
header shape needs no code at all.

Field keys are `payload_codec`'s: `offset`, `length`, `type` (`uint8`/`int8`/
`uint16`/`int16`/`uint32`/`int32`/`float32`/`bcd`), `endian` (`big` by default),
`scale`, `value_offset`, `bit`. The frame's length is the highest
`offset + length`, so a fixed-width trailing byte needs a field even if it is
always zero.

Constants win over caller-supplied parameters, and a collision is an **error**:
a caller must not be able to reach the opcode byte. A command name the driver
does not define is refused rather than falling back to the platform's JSON
envelope, which a third-party device cannot parse.

`"mode": "passthrough_json"` reproduces the platform's pre-driver payload
exactly, for a device type that wants a transport binding without a codec.
`"script"` — a vendor's own `*-decoder.js` / `*-encoder.js` — is phase 3 and is
currently refused, because executing vendor code beside every tenant's data is a
sandbox decision that has not been made.

### 3. Telemetry

The uplink decoder, in **exactly** the shape `device_types.decoder` has always
used — same field keys, same optional `f_port` filter, same engine:

```jsonc
"telemetry": {
  "mode": "declarative",
  "f_port": 2,
  "fields": [ /* the decoder's `fields`, unchanged */ ]
}
```

That sameness is the point: absorbing the standalone column is a move, not a
translation, so a device type that already decodes keeps decoding identically.
The column remains the fallback and is still what every live device type uses —
a driver's `telemetry` simply wins when present.

Neither B METERS driver carries one yet, for reasons recorded in the files
themselves: the IWM manual leaves four fields undecodable, and RFM uplinks
concatenate several `Type|Index|Data` frames with no length byte, which a
fixed-offset field spec cannot express. Declaring half of either would decode
plausibly and wrongly.

### 4. Acknowledgement and timing

```jsonc
"acknowledgement": {
  "mode": "echo_opcode",              // echo_opcode | echo_frame | none
  "opcode_field": "fct",              // which command field carries the opcode
  "response": {
    "opcode_offset": 0,               // where the opcode sits in the uplink
    "kind_offset": 1,                 // where the ack/nack discriminator sits
    "ack_values": [1],
    "nack_values": [],                // optional
    "error_offset": 2,                // optional: non-zero here means failure
    "error_names": {"0x04": "Error length"}
  },
  "response_window_seconds": 43200,
  "unacknowledgeable_commands": ["reset"]
}
```

**Correlation is by (device, opcode), because no third-party device echoes the
platform's `command_id`.** An IWM answers with the same `Fct` byte it was sent;
an RFM echoes the whole frame and refuses with `0x02 <Index>`. Both are the same
two bytes read at different offsets, which is why this is declared rather than
branched on — and why a third vendor's dialect of "yes" needs no code either.

`opcode_field` names the field in each command definition whose constant is that
opcode. Every command must have one once correlation is declared, and
`opcode_field` and `response` are both-or-neither: half a declaration reserves
opcodes and matches nothing, so commands would expire *and* block their
successors.

That reservation is real. `device_commands.opcode` carries the value, and a
partial unique index refuses a second command on the same (device, opcode) while
one is in flight — because two answers to one opcode cannot be told apart. It is
an index rather than a check in the router deliberately: two dispatches arriving
together would both read "nothing outstanding" and both proceed.

`error_names` maps a byte to the vendor's own words for the failure, which is
what a NACK records instead of a bare "failed".

`response_window_seconds` replaces the platform's 60-second default for this
device type. It is capped at seven days.

`unacknowledgeable_commands` is the important one. A command listed here reaches
`delivered_unconfirmed` — a terminal state — as soon as it is delivered, instead
of waiting for a reply that will never arrive and then being recorded as
`timed_out`. Get this list wrong and the platform reports correctly delivered
commands as failures. A name in it that matches no defined command is refused on
save for exactly that reason.

### 5. Receive window

Recorded, never simulated. The platform does not model the LoRaWAN MAC and does
not schedule around RX slots; this section exists so it can *say* that a device
only listens shortly after it speaks. Nothing reads it at dispatch time.

### 6. Check it

`api/tests/test_device_driver.py` validates every file in this directory, so a
new driver is covered the moment it lands here. Add its vendor's worked examples
as byte assertions alongside the B METERS ones — that is the only thing that
catches a transcription error, and it needs no network.

The correlation *write* — what actually closes a command when its device answers
— is the processor's, and is tested in
`processor/tests/test_driver_ack_correlation.py`.
