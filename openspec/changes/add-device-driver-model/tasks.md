> Each phase ships independently and leaves the system working. The acceptance
> criterion throughout: **adding a vendor must require no platform code.** If a
> task here makes the next device family need a dispatch branch, a parser, or a
> lifecycle special case, it is the wrong task.

## 1. Driver model and transport binding (phase 1)

- [ ] 1.1 Migration: `device_types.driver` (JSONB, nullable). Nullable **is** the
      compatibility guarantee — absent means precisely today's behaviour, so the
      68 live meters are untouched until someone writes a driver for their type.
- [ ] 1.2 A schema for the declaration (transport, commands, telemetry,
      acknowledgement, receive_window), validated on write. A malformed driver
      must be rejected when saved, not when a command is dispatched at 2am.
- [ ] 1.3 Driver resolution: device → device type → driver, with a null-driver
      path that returns today's behaviour verbatim.
- [ ] 1.4 `_detect_protocol()` consults the driver's `transport.protocol`, then
      the device type's declared protocol, then today's heuristics. An
      unrecognised protocol **raises** — no default. A `modbus` device currently
      has its commands published to an MQTT channel silently, which is the exact
      failure this removes.
- [ ] 1.5 Transport parameters come from the driver (LoRaWAN fPort and confirmed
      flag, MQTT topic, HTTP shape) rather than the hardcoded fPort 201.
- [ ] 1.6 `transport.mode` is an **explicit** discriminator
      (`payload` | `register_map` | `edge_gateway`), and only `payload` is
      implemented. The target protocol surface contains three structurally
      different families — payload messaging, register/address-space polling
      (Modbus, BACnet, DNP3, OPC UA, KNX, and Zigbee/Z-Wave/BLE at the
      application layer), and edge-adjacent buses needing a gateway (RS485, CAN,
      I²C…). An unimplemented mode must be **rejected on write** with a clear
      reason, not silently treated as `payload`.
- [ ] 1.7 Assert that no code outside a driver assumes "a device sends payloads".
      The moment that leaks into dispatch, the lifecycle or ingest, register
      protocols become a rewrite rather than an addition — and Modbus RTU over
      RS485 brings families 2 and 3 at the same time.

## 2. Declarative downlink encoding (phase 1)

- [ ] 2.1 An encoder that turns command name + parameters into bytes from a
      declarative field spec: offset, length, type, endianness, scaling.
- [ ] 2.2 `dispatch()` encodes **before** choosing a transport, so encoding is
      protocol-independent by construction rather than per-transport by accident.
- [ ] 2.3 A `passthrough_json` form reproducing today's exact payload, used when
      no driver is present. Byte-identical — assert it.
- [ ] 2.4 B METERS IWM and RFM command definitions from
      `research/b-meters-commands.md`. Note the header shapes differ (5-byte vs
      2-byte) and `0x0A` means different things on each; if one definition can
      express both, something is wrong.
- [ ] 2.5 Encode tests against the manuals' worked examples. RFM has seven that
      decode cleanly. **Do not** use the IWM `0x26` examples — the research found
      them internally inconsistent (one encodes a 33,685,504 mV battery
      threshold against a documented 2200 mV default).

## 3. Timing and acknowledgement semantics (phase 1)

- [ ] 3.1 `response_window_seconds` per driver replaces
      `DEVICE_RESPONSE_TTL_SECONDS` for typed devices; the constant remains only
      as the no-driver default.
- [ ] 3.2 `expire_timed_out_commands` honours the per-driver window. An IWM
      command must survive up to 12 hours, not 60 seconds.
- [ ] 3.3 An `unacknowledgeable_commands` list, and a terminal state for
      delivery-without-confirmation. IWM `RESET` and RFM `0x03 0x05` never answer;
      without this a correctly delivered command is recorded as a failure.
- [ ] 3.4 Declare the receive-window constraint (Class A, ~2-minute post-join
      window on both B METERS families). Recorded and surfaced, not simulated —
      the platform should be able to say "this device only listens after it
      speaks", not pretend to schedule around it.

## 4. Verification (phase 1)

- [ ] 4.1 A device type with no driver behaves byte-identically to today, on
      every transport. This is the test that lets phase 1 ship safely.
- [ ] 4.2 Encoding is asserted against expected bytes — no network server needed,
      so ChirpStack being unreachable blocks nothing.
- [ ] 4.3 An unknown protocol raises rather than publishing to MQTT.
- [ ] 4.4 A per-driver window governs expiry; a 12-hour command is still
      outstanding after an hour.
- [ ] 4.5 An unacknowledgeable command reaches its terminal state on delivery and
      is never swept to `timed_out`.
- [ ] 4.6 **The criterion test**: add a fictional third vendor with a third
      header shape as a driver declaration only, and assert it dispatches
      correctly with no source change. If this needs a code edit, phase 1 failed.

## 5. Acknowledgement correlation via uplink decode (phase 2)

- [ ] 5.1 Absorb `DeviceType.decoder` into `driver.telemetry`. A **move, not a
      rewrite** — the field spec is unchanged, so this is relocation.
- [ ] 5.2 Gate: decoding output is byte-identical before and after for every live
      device type. 68 real meters depend on this path; nothing ships until it is.
- [ ] 5.3 Correlate responses on **(device, opcode)** with at most one command in
      flight per pair, since no third-party device echoes our `command_id`.
- [ ] 5.4 Support both observed confirmation styles: IWM echoes the opcode with
      `C/R/A=0x01`; RFM echoes the full frame and has a real NACK (`0x02 <Index>`).
- [ ] 5.5 A NACK moves the command to failed with the device's reason, rather than
      leaving it to time out.

## 6. Script codecs and the sandbox (phase 3)

- [ ] 6.1 **Spike first.** Run a hostile codec — infinite loop, memory bomb,
      filesystem probe, network call, prototype pollution — against QuickJS,
      a V8 isolate (`mini-racer`), and `node` under rlimits. Record what actually
      happened for each, not what the documentation claims.
- [ ] 6.2 Choose a runtime from that evidence. **If none contains hostile input,
      stop.** Phases 1-2 already deliver multi-vendor support; the declarative
      path is not a consolation prize.
- [ ] 6.3 Execute codecs in the **processor**, where `shared/payload_codec`
      already runs — never in the API process that serves authenticated requests.
- [ ] 6.4 Enforce no filesystem, no network, no host bindings, hard CPU,
      wall-clock and memory ceilings, and no state carried between tenants.
- [ ] 6.5 Milesight as the worked example: a vendor `*-decoder.js` and
      `*-encoder.js` used **unmodified**. Modifying them to fit would defeat the
      point of the phase.
- [ ] 6.6 A failing codec degrades to "payload undecodable" for that message
      only. One tenant's bad codec must not affect another tenant's ingest.
- [ ] 6.7 Do **not** vendor Milesight's files into the repo — GPL-3.0, and
      runtime-supplied codecs avoid the distribution question entirely.

## 7. Retire the heuristics (phase 4)

- [ ] 7.1 Once every live device type declares a transport, remove the
      `dev_eui`/`webhook_url`/default-MQTT inference from `_detect_protocol`.
- [ ] 7.2 Confirm `ota_dispatch` still resolves correctly — it shares
      `_detect_protocol` and inherits this change.

## 8. Documentation

- [ ] 8.1 How to write a driver, both forms, with B METERS as the declarative
      worked example and Milesight as the script one.
- [ ] 8.2 `CLAUDE.md`: drivers are file-defined and version-controlled, not
      UI-authored — adding a vendor is a deploy. Record why: byte offsets
      transcribed from a manual want review and history, not a text box.
- [ ] 8.3 Record the sandbox's actual measured limits, not its intended ones.

## Blocked / awaiting external input

- [ ] 9.1 IWM **decoder** waits on the integrators' supplement the manual points
      to (`ticket@bmeters.com`). Four fields are undecodable as documented —
      alarm date packing has no worked example, and `0x17`'s stated length
      contradicts its own byte table. The **encoder is not blocked**.
- [ ] 9.2 End-to-end LoRaWAN delivery waits on ChirpStack reachability. Encoding
      and decoding are fully testable without it; only delivery is not.
