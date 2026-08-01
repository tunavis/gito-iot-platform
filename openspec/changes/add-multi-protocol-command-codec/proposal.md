> **Framing (2026-08-01).** This is not a B METERS change and not a LoRaWAN
> change. The platform's purpose is multi-vendor, multi-device, multi-protocol
> integration — that is the bar Cumulocity, ThingsBoard and AWS IoT already
> meet, each by treating "how to speak to this device" as **data** rather than
> code. We currently treat it as code, with one hardcoded dialect.
>
> B METERS earns its place here only as evidence, and it is unusually good
> evidence: **one vendor's two product lines already share nothing.** IWM-LR3/LR4
> uses a 5-byte header with the verb baked into the opcode; RFM-LR1 uses a 2-byte
> header with an explicit Set/Query/Action verb over a shared index space. Their
> acknowledgement models differ. Their timeouts differ by three orders of
> magnitude. And `0x0A` means "reset the microcontroller" on one and "read CPU
> temperature" on the other.
>
> If a single vendor's own catalogue cannot share a codec, no global table can.
> The unit of declaration must be the **device type**, and the design must be
> settled before a second vendor arrives rather than retrofitted after.

## Why

The platform can only send commands to devices that speak **its own JSON
convention**. `CommandDispatchService.dispatch()` builds one payload before any
transport is chosen —

```python
payload = {"type": "command", "command_id": ..., "command": ..., "parameters": {...}}
```

— and every transport just serialises that same dict: JSON to a Redis channel for
MQTT, JSON in a POST body for HTTP, JSON base64'd onto fPort 201 for LoRaWAN. A
device built for this platform works. **No third-party device does, on any
transport.**

That is not a LoRaWAN problem, and fixing it for one meter family would repeat
the mistake at a smaller scale. It is a missing layer: nothing between "a command
was requested" and "bytes went out" ever asks what *this device* expects.

Two things made it visible now:

- The MCP approval gate shipped, giving agents a way to request commands — and
  then there was nothing on the fleet to request them against. Of 68 real
  devices, zero sit on a device type with the `commands` capability.
- The B METERS IWM-LR3/LR4 manual (§3, "Command list descriptions (downlink)")
  documents six real commands — `GET_FW_VERSION` `0x07`, `Reset` `0x0a`,
  `SET/GET_DATE_AND_TIME` `0x14`/`0x15`, `SET/GET_REVOLUTION_COUNTERS`
  `0x16`/`0x17` — as **binary opcodes on LoRaWAN port 1**. The dispatcher sends
  JSON on port 201. Enabling the capability today would produce a command that
  reports `sent` and does nothing.

A third gap sits alongside it: `_detect_protocol()` reads
`device.attributes.protocol`, `dev_eui`, or a webhook URL, and **never consults
the device type's declared `connectivity.protocol`**. The "Energy Meter" type
declares `modbus`, `dispatch()` has no modbus branch, and such a device with no
attribute override falls through to the default — its command is published to an
MQTT channel, silently.

## What Changes

- **New** a declarative **command codec** on `DeviceType`, the mirror of the
  `decoder` this repo already uses for uplinks: how a command name and its
  parameters become a wire payload, plus the transport details that payload needs
  (LoRaWAN fPort and confirmed flag, MQTT topic suffix, HTTP body shape).
- **New** codec resolution in `dispatch()`, applied **before** transport
  selection, so encoding is protocol-independent by construction rather than
  per-transport by accident.
- **New** a `passthrough_json` codec that reproduces today's exact behaviour, and
  is the **default when a device type declares none**. Every device working today
  keeps working, byte for byte.
- **New** B METERS IWM-LR3/LR4 and RFM-LR1 command definitions from the manual,
  as the first real codec — the proof the abstraction fits hardware nobody here
  designed.
- **Modified** `_detect_protocol()` to consult the device type's declared
  protocol, so `connectivity.protocol` stops being decorative. An unknown or
  unimplemented protocol must **fail loudly** rather than defaulting to MQTT.
- **Modified** command lifecycle for devices that cannot acknowledge. See below —
  this is the part most likely to be missed.

## The acknowledgement problem

Today's lifecycle assumes the device replies through telemetry with reserved keys
(`command_id`, `command_status`), and `expire_timed_out_commands` flips anything
still `pending`/`sent` past its TTL to `timed_out`.

**A third-party device will never send those keys.** It answers in its own
protocol or not at all. So every correctly-delivered command to a B METERS meter
would sit at `sent` for 60 seconds and then be recorded as `timed_out` — a
successful command permanently filed as a failure.

So a device type must be able to declare its acknowledgement model: either it
correlates responses (today's behaviour), or delivery is terminal and `sent` is
the final honest state. Without this, making commands *work* would make the
records *lie*, which is worse than the current honest 400.

## Capabilities

### New Capabilities
- `device-command-encoding`: how a command becomes bytes for a specific device,
  independent of transport; what a device type declares; and what the platform
  may claim about a command it cannot get acknowledgement for.

### Modified Capabilities
- `integrations-and-commands`: dispatch gains an encoding step, protocol
  detection consults the device type, and an unsupported protocol fails instead
  of defaulting.

## Impact

**Database** — `device_types.command_codec` (JSONB, nullable). Nullable *is* the
backwards-compatibility guarantee: absent means today's JSON.

**Services** — `app/services/command_dispatch.py` (encode before transport),
`app/services/ota_dispatch.py` (`_detect_protocol` lives here and is shared),
`shared/payload_codec` (the encoder belongs beside the existing decoder).

**Data** — command schemas and codecs for the two B METERS types; the `commands`
capability enabled on them **last**, once the rest demonstrably works.

**Not blocked by ChirpStack reachability.** The ChirpStack environment exists but
is on another network. Encoding is unit-testable against expected bytes with no
network server at all; only the final end-to-end needs the connection.

## What else is hardcoded that a second vendor breaks

Found while establishing the above. Each is somewhere the platform assumes one
dialect, and each is a separate way the next integration fails:

- **`_detect_protocol()` guesses.** `dev_eui` implies LoRaWAN, a `webhook_url`
  implies HTTP, everything else defaults to MQTT. Heuristics do not survive N
  protocols, and the device type's declared `connectivity.protocol` is ignored
  entirely.
- **The command TTL is a constant** (`DEVICE_RESPONSE_TTL_SECONDS = 60`). An
  IWM meter reports on an interval of up to **12 hours**, and its interval is
  NFC-only — not settable over the air. A 60-second timeout marks every such
  command failed long before the device could possibly have answered.
- **"Delivered" assumes the device echoes our correlation id** through telemetry.
  No third-party device does. IWM echoes the opcode; RFM echoes the whole frame
  and has a real NACK; two commands across the two families never acknowledge at
  all. Correlation must be declared per type, and "cannot be acknowledged" must
  be a legal, honest terminal state.
- **`decoder` is LoRaWAN-shaped**, so the uplink half has the same problem the
  downlink half does.
- **Receive windows are not modelled.** Both B METERS families have a ~2-minute
  post-join CONFIGURE window that is the only period with frequent RX slots.
  Class A LoRaWAN devices receive only after an uplink. Nothing in the platform
  knows a command may have to wait for the device to speak first.

None of these are B METERS problems. They are the shape of the general problem,
found using the one vendor whose manuals we have.

## Open Questions

- **Is Modbus real today, or is that device type aspirational?** It decides
  whether the codec needs a register/coil model or only byte payloads. Nothing
  speculative should be built for it until answered — but `_detect_protocol` must
  stop silently routing it to MQTT either way.
- Do the RFM-LR1 meters share the IWM command set, or need their own definitions?
- Should a codec be authorable in the device-type UI, or file-defined for now?
  The command *schema* editor already exists; the codec is a lower-level concern
  and may not belong in the same screen.
