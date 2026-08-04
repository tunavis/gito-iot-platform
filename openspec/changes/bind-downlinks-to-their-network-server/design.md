## Context

Measured on the live system, 2026-08-03, not inferred:

- **68 devices, all LoRaWAN.** 0 carry `chirpstack_server`/`chirpstack_api_key`;
  `CHIRPSTACK_API_URL` is unset; `device_commands` has **0 rows**. The downlink
  path in `_dispatch_lorawan` has never executed against anything.
- **Uplinks arrive over MQTT, anonymously.** `integrations` holds
  `{"tls": false, "port": 2883, "broker_url": "mqtt.cordys.co.za"}` — no
  username, no password — and the bridge only sends credentials if present. A
  live capture confirmed the topic and the application:
  `application/3c815fb6-…/device/e41e0a900000856d/event/up`,
  `applicationName: watermeterApp`, `fPort: 1`. It decodes cleanly through the
  device type's existing decoder.
- **There is no direct connection to ChirpStack.** We subscribe to a broker it
  publishes to. Its REST API has never been called and is not reachable from the
  API host — a listener from the Windows host timed out on the broker while the
  same code inside the container connected instantly.
- **No encryption exists in `api/app`.** `integrations.key_hash` is a SHA-256 of
  an *inbound* key issued by `_generate_key()` — for an external system calling
  us — and cannot authenticate an outbound call.

Two facts drive everything below. ChirpStack's MQTT integration is
**bidirectional** — it subscribes to `application/{app}/device/{devEui}/command/down`
— so this client needs no API token. And **not every client will be this
client**: some will only offer the HTTP integration, pushing uplinks to an
endpoint of ours, with a REST token for downlinks or nothing at all.

## Goals / Non-Goals

**Goals:**
- A downlink reaches the network server the device is on, or it fails saying so.
- A server that cannot accept downlinks says so, and its commands are refused
  immediately rather than expiring.
- Adding a second network server is a row and a binding, not a deployment.
- One credential per server, encrypted, never per device.
- A device with no binding behaves exactly as it does today.

**Non-Goals:**
- The HTTP **uplink** webhook route. It does not exist and is the next change.
- Renaming `ttn_app_id`. (Done afterwards on its own, in migration 032 —
  `lorawan_app_id`. Kept out of here on purpose.)
- Multi-instance uplink routing — already works, per integration.
- A general-purpose secrets subsystem. One class of secret, kept small.

## Decisions

### The downlink transport is an explicit discriminator

`integrations.downlink_mode` ∈ `mqtt` | `rest` | `none`, required before a
downlink can be sent, **never inferred from how uplinks arrive**.

This is the same decision as the driver's `transport.mode`, for the same reason.
Inferring "uplinks come by MQTT, so downlinks go by MQTT" is true for the client
in front of us and false for the next one. An explicit mode makes the second
client a row; an inferred one makes them a rewrite.

| mode | endpoint | credential |
|---|---|---|
| `mqtt` | the broker already in `config`, topic `application/{app}/device/{eui}/command/down` | none, or a broker password/certificate |
| `rest` | `downlink_api_url` + `POST /api/devices/{eui}/queue` | a ChirpStack API token |
| `none` | — | — |

### `none` is an answer, not an absence

A network server we can receive from but not send to is a real configuration —
a client who forwards uplinks and grants nothing else. Declaring it means a
command to those devices is **refused at creation with that reason**.

Without it the command queues, waits out its full response window — up to twelve
hours for an IWM — and is recorded `timed_out`, which asserts the device stayed
silent. The device was never addressable. That is the same lie
`delivered_unconfirmed` was added to stop telling from the other direction.

### MQTT downlinks go out on the bridge that is already connected

`ChirpStackBridge` holds one live connection per integration and already runs
concurrent tasks beside its message loop. The downlink is published on that same
client, fed from Redis exactly as the existing local `CommandBridge` is fed.

This is chosen over opening an MQTT connection from the API because it makes the
multi-instance guarantee **structural**: a bridge can only publish to its own
broker, so a downlink physically cannot reach the wrong server. A resolver in
the API would be a correctness argument instead of a constraint. It also means
the API keeps no broker connections, and a client whose broker is unreachable
degrades to a queued Redis message rather than a blocked request.

Rejected: publishing from the API directly. Rejected: routing MQTT downlinks
through the REST path for uniformity — that would require the token this design
exists to avoid needing.

### The application id lives on the device, because it varies per device

The downlink topic needs the ChirpStack application id. Devices on one server
can be in different applications, so it is a device property, not an integration
property.

`devices.ttn_app_id` already exists and is documented "provider-agnostic". It is
NULL on all 68 devices today. It is populated from the uplink — the id is in the
topic and in `deviceInfo.applicationId`, and we discard it on every message.

**Observation wins over a hand-entered value.** An earlier draft said the
opposite, which contradicted its own next sentence about a device moved to
another application. The device's traffic is the authority on where it reports
from: a downlink addressed to where someone *believed* the device was lands in
the wrong application. Setting it by hand exists to seed a device that has not
yet spoken — as the first test device had to be — not to override reality.

Observing this is **not** the inference rejected below. The application id is a
fact the device's own traffic states about itself, and the topic cannot be
formed without it. Which *server* a device belongs to is a routing decision, and
that stays explicit.

### The binding is a foreign key, not an inference

`devices.integration_id` → `integrations.id`, nullable, `ON DELETE SET NULL`.

Rejected: deriving the binding from which bridge saw the uplink. A device could
not then be dispatched to until it had spoken, which excludes the ~2-minute
post-join window that is the only reliable provisioning window on both B METERS
families — and when it is wrong it is wrong silently. A **report** proposing
bindings from observed traffic, for a person to apply, is in scope.

### An explicit binding never falls back

| `integration_id` | integration state | outcome |
|---|---|---|
| set | mode usable, endpoint present | dispatch |
| set | `none`, missing, disabled, or misconfigured | **refuse, with the reason** |
| null | — | today's order: device attributes, then the setting |

The middle row is the point. Falling back would send the command to *a* server —
the wrong one — over possibly the wrong protocol, and report success. It refuses
the way an unrecognised protocol now refuses.

### The credential is encrypted at rest, and a missing key fails the boot

Needed by both modes: a REST token, or an MQTT password/certificate once a
client's broker is not anonymous. Fernet, key from the environment, stored
`enc:v1:<token>` so the scheme is versioned and an unencrypted value is obvious
rather than plausible.

**Enforced as a SQLAlchemy column type**, not a helper. `EncryptedString`
encrypts on the way in, so no write path can forget; a column that *can* hold
plaintext eventually does. A value found without the prefix is refused rather
than returned — returning it would mean a plaintext credential works perfectly
and nobody finds out. Reads return a mask, mirroring `key_prefix`.

Rejected: plaintext in `config`, because "it is what the other fields do" is how
a config column becomes a credential store. Rejected: a secrets manager, as
infrastructure that costs more than it buys for one secret per server.

Accepted trade-off, stated rather than implied: an attacker with both the
database and the application environment gets the credential.

## Risks / Trade-offs

- **A wrong binding is worse than no binding** — it dispatches confidently to the
  wrong place. → The never-falls-back rule, plus a report that proposes bindings
  rather than applying them.
- **`sent` over MQTT is weaker than it sounds.** QoS 1 confirms delivery to the
  *broker*, not to ChirpStack, and certainly not to the meter. → Recorded as
  `sent`, exactly as the REST path's 200 is; the honest confirmation is still
  the device's own answer, correlated by opcode.
- **The first stored secret sets the pattern for every later one.** → Kept
  deliberately small: one key, one algorithm, one versioned prefix.
- **Key loss makes stored credentials unrecoverable.** → They are re-enterable;
  the failure is an outage, not data loss, and it belongs in the runbook.
- **Still unexercised end to end.** This makes resolution correct; it does not
  prove a byte reaches a meter. That is task 6.1 and nothing substitutes for it.

## Migration Plan

1. Additive schema: `devices.integration_id`, `integrations.downlink_mode` +
   `downlink_api_url` + encrypted `downlink_api_key`. Nothing backfilled.
2. The secret helper and its startup check.
3. Resolution behind the null-means-today rule, shared with `ota_dispatch`.
4. MQTT downlink publishing on the existing bridge; application id captured at
   ingest.
5. A binding-proposal report, run by a person.
6. Bind the live fleet, then prove one command end to end.

**Rollback:** every column is nullable and additive; dropping them returns every
device to the current resolution order.

## Open Questions

- Whether an unbound LoRaWAN device should eventually be an error rather than a
  fallback, and what surfaces that.
- Whether to wait for PUBACK before marking `sent` — see the trade-off above.
