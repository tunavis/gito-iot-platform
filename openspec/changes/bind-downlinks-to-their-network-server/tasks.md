> The acceptance criterion: **a command is never dispatched to a network server
> the device is not on, and never left pending against one that cannot accept it
> at all.** A wrong server is worse than a refusal, because it reports success.
> A command pending against an unreachable server is worse still, because it
> eventually blames the meter.
>
> If a task here makes an unresolvable binding fall back to a global default, or
> infers a downlink transport from how uplinks arrive, it is the wrong task.

## 1. The secret, before anything stores one

- [x] 1.1 A single encryption helper — Fernet, key from the environment, stored
      `enc:v1:<token>`. Versioned prefix so the scheme can rotate, and so an
      unencrypted value is obvious on sight rather than plausible.
- [x] 1.2 A missing key **refuses** rather than degrading to plaintext or to
      skipping decryption. A guard that no-ops is worse than one that fails.
- [x] 1.3 Encryption applied by the column type, which no write path can bypass.
      A column that *can* hold plaintext eventually does.
- [x] 1.4 Reads return a mask, reusing `key_prefix`'s convention so the UI has
      one way of showing a partial secret.
- [x] 1.5 Round-trip, wrong-key, tampered-token and plaintext-in-column tests.
- [x] 1.6 Startup check: fail to boot when encrypted secrets exist and the key is
      absent. Currently the refusal happens at first use, which is late.

## 2. The binding and the declaration

- [x] 2.1 Migration: `devices.integration_id` (nullable FK, `ON DELETE SET NULL`).
      Nullable **is** the compatibility guarantee.
- [x] 2.2 Migration: `integrations.downlink_mode` (`mqtt` | `rest` | `none`),
      `downlink_api_url`, and the encrypted `downlink_api_key`. **Amends 031**,
      which assumed REST — it is uncommitted and applied only to the dev
      database, so it is corrected rather than patched by a follow-up.
- [x] 2.3 Validate the mode on write: unknown or unimplemented is refused when
      saved, not when a command is dispatched. `mqtt` requires broker config,
      `rest` requires a URL, `none` requires neither.
- [x] 2.4 `integration_id` on the device create/update schemas and router,
      refusing an integration from another tenant. RLS is inert here, so this
      check *is* the boundary.
- [x] 2.5 Deleting an integration clears the reference rather than the device.
      Assert it — `ON DELETE SET NULL` is easy to write and easy to get wrong.

## 3. Resolution

- [x] 3.1 One resolver, shared by `command_dispatch` and `ota_dispatch`, for the
      same reason `_detect_protocol` is shared.
- [x] 3.2 A device that names an integration **never falls back**.
- [x] 3.3 A device that names nothing resolves exactly as today.
- [x] 3.4 The failure reason reaches the command row.
- [x] 3.5 Extend the resolver to return the **mode**, not just an endpoint, and
      to refuse `none` with a reason naming the server rather than the device.
- [x] 3.6 Refuse a `none`-mode command **at issue**, before a row enters the
      pending lifecycle, so it is never swept to `timed_out`.

## 4. MQTT downlinks, on the connection that already exists

- [x] 4.1 `ChirpStackBridge` gains a downlink publisher fed from Redis, exactly
      as the local `CommandBridge` is. Publishing on the bridge's own client is
      what makes multi-instance structural: a bridge **cannot** reach another
      server's broker.
- [x] 4.2 Topic `application/{application_id}/device/{dev_eui}/command/down`,
      body `{devEui, confirmed, fPort, data}` — `data` is the driver's encoded
      frame, `fPort` and `confirmed` come from the driver.
- [x] 4.3 The API publishes to Redis and returns; it opens no broker connection.
      A client whose broker is unreachable must not block a request.
- [x] 4.4 A downlink for an integration whose bridge is not connected is
      reported, not silently dropped into Redis.

## 5. The application id

- [x] 5.1 Capture `deviceInfo.applicationId` at ingest into `devices.ttn_app_id`
      (already documented provider-agnostic). It arrives on every uplink and is
      currently discarded.
- [x] 5.2 An **observed** value wins over a hand-entered one — the device is
      the authority on where it reports from. Setting it by hand seeds a
      device that has not yet spoken. (The task originally said the reverse,
      which contradicted its own 'device moved application' scenario.)
- [x] 5.3 A device with no application id and an `mqtt` binding is refused with
      that reason — the topic cannot be formed, and guessing it would publish
      into another application.

## 6. Verification

- [x] 6.1 An unbound device dispatches byte-identically to today. This is the
      test that lets it ship — 68 live devices are unbound.
- [x] 6.2 A bound device dispatches to its own integration while a platform-wide
      setting names a different one.
- [x] 6.3 Two devices bound to two integrations reach two endpoints in one test.
- [x] 6.4 A bound device whose integration is unusable fails and **nothing is
      posted anywhere**. Assert the absence, not just the failure.
- [x] 6.5 The stored credential is unusable when read straight from the database.
- [x] 6.6 A `none`-mode server refuses at issue and leaves no pending row.
- [x] 6.7 An `mqtt` binding publishes the exact topic and body above, asserted
      against a recorder rather than a live broker.
- [x] 6.8 `ota_dispatch` resolves through the same binding as a command.

## 7. Adoption

- [x] 7.1 A report proposing bindings from observed uplinks, for a person to
      apply. Reporting only — a wrong binding is silent, and a human is the check.
- [x] 7.2 Bind the live fleet from that report, once reviewed. Done 2026-08-03:
      68/68 LoRaWAN devices bound to 'Testing2' (mode=mqtt) via
      `scripts/bind_fleet_to_network_server.py`. 50 awaited an application
      id at the time and fill in as they report.
- [x] 7.3 Surface unbound LoRaWAN devices where an operator looks, so the null
      path is visible rather than merely permitted.

## 8. The proof this whole thing was for

- [x] 8.1 **One command, one real device, end to end** — `get_fw_version`
      (`07 00 00 00 00`) to `e41e0a9000009390`, over MQTT, on a binding. Five
      bytes, no parameters, no state change, a documented answer. It exercises
      encoding, the binding, the topic, fPort 1, the per-driver response window
      and correlation by opcode in one act.
      **Never against a global setting** — proving it that way would make the
      shortcut permanent.
- [ ] 8.2 Record what arrived: the published frame, the device's answer, and the
      command's final status. `device_commands` has never held a row.

## 9. Documentation

- [x] 9.1 How to add a network server: the integration row, its downlink mode and
      whatever that mode needs, and binding devices to it.
- [x] 9.2 Runbook: losing the encryption key is an outage, not data loss —
      credentials are re-enterable. Say so before someone discovers it.
- [x] 9.3 `CLAUDE.md`: the binding, the explicit downlink mode, and that an
      explicit binding never falls back.

## Blocked / awaiting external input

- [x] 10.1 Task 8.1 needs the operator's nominated device — supplied,
      `e41e0a9000009390` — and a bridge connected to its broker. Everything
      before it is testable without either.
- [ ] 10.2 The HTTP **uplink** webhook route is out of scope here and is what the
      first push-only client will need. The inbound credential mechanism already
      exists (`_generate_key`); the route does not.
