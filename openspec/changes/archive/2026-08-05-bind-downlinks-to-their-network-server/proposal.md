## Why

Dispatch assumes one way of reaching a network server, and it is the wrong one.

```python
chirpstack_url = attrs.get("chirpstack_server") or settings.CHIRPSTACK_API_URL
api_key       = attrs.get("chirpstack_api_key") or settings.CHIRPSTACK_API_KEY
```

Per-device attributes, else **one global environment variable**, and always
ChirpStack's REST API. Measured on the live system 2026-08-03: **0 of 68 devices
carry those attributes, `CHIRPSTACK_API_URL` is unset, and `device_commands` has
0 rows.** No downlink has ever been sent. `_dispatch_lorawan` has never executed.

Meanwhile uplinks arrive by a completely different route. ChirpStack's **MQTT
integration** publishes to `mqtt.cordys.co.za:2883` and the processor subscribes
**anonymously** — there is no direct connection to ChirpStack at all. A live
capture:

```
application/3c815fb6-cc9c-495e-97c6-e7b3ccf4e1bd/device/e41e0a900000856d/event/up
applicationName: watermeterApp   fPort: 1
```

That same MQTT integration is **bidirectional**: ChirpStack subscribes to
`application/{app}/device/{devEui}/command/down`. So for this client the downlink
needs no API token, no REST endpoint, and no new network path — the connection
is already open. The REST credential the code assumes would be a key with
authority over every device on the server, created for nothing.

**But narrowing to MQTT would be the same mistake reversed.** Not every client
will hand over broker access. Some will only offer ChirpStack's HTTP integration
— pushing uplinks to an endpoint of ours — and either an API token for downlinks
or nothing at all. The two directions are independent, and a client who can only
push to us **cannot receive downlinks at all**. Today that device's command
would queue, sit for its full response window, and be reported `timed_out`,
blaming a meter that was never reachable.

Now, because the driver model has made commands correctly encoded and the next
step is proving one end to end. Doing that against a global setting would fix
the shortcut permanently, and doing it MQTT-only would build the next client's
migration into the foundation.

## What Changes

- **`devices.integration_id`** — a nullable foreign key naming the network
  server a device is reached through. Nullable **is** the compatibility
  guarantee: absent means exactly today's resolution.
- **`integrations.downlink_mode`** — an **explicit discriminator**,
  `mqtt` | `rest` | `none`, never inferred from how uplinks happen to arrive.
  The same pattern as the driver's `transport.mode`: an unimplemented or
  unavailable mode is refused on write, not silently assumed.
- **`none` is a first-class answer.** A network server we can receive from but
  not send to declares it, and commands to its devices are **refused
  immediately with that reason** rather than expiring against a device that was
  never addressable.
- **MQTT downlinks reuse the connection that already exists.** `ChirpStackBridge`
  holds one live connection per integration; the downlink is published on it, so
  multi-instance is correct by construction — a bridge can only reach its own
  broker.
- **The ChirpStack application id is captured from uplinks** into the existing
  `devices.ttn_app_id` (already documented "provider-agnostic"), because the
  downlink topic requires it and we currently discard it on every message.
- **An outbound credential is encrypted at rest.** Needed by both modes — a REST
  Bearer token, or an MQTT password or client certificate the moment a client's
  broker is not anonymous. There is **no encryption anywhere in `api/app`**
  today, so this change introduces the platform's first stored secret.
- **Dispatch resolves device → integration → mode → endpoint**, falling back to
  the current order only for a device that names no integration. A device that
  *does* name one **never falls back**.
- **BREAKING (operational, not API):** with more than one network server,
  `CHIRPSTACK_API_URL` stops being sufficient. It remains the fallback for a
  single-server deployment and is not removed here.

**Not in scope:** the HTTP *uplink* webhook endpoint. A client's ChirpStack
POSTing uplinks to us has no route in this codebase — confirmed by a live 404 on
the shape currently in use elsewhere. The credential mechanism for it already
exists (`integrations.key_hash` issues a key to an external caller); the route
does not. That is the next change, not this one, and this change must not
assume uplink and downlink transports match.

## Capabilities

### New Capabilities
- `network-server-binding`: which network server a device is reached through,
  how downlinks reach it, and where the credential for that lives. Covers the
  guarantee that a command is never dispatched to a server the device is not on,
  and never left pending against a server that cannot accept downlinks at all.

### Modified Capabilities
- `integrations-and-commands`: dispatch resolves a network server and its
  downlink transport from the device's binding rather than from a global
  setting; an unresolvable binding fails loudly instead of defaulting.
- `device-management`: a device records the integration it is reached through
  and the network-server application it belongs to.
- `telemetry-ingestion`: the ingest path records the application id an uplink
  states, so a downlink can be addressed back to the same application.

## Impact

**Database** — `devices.integration_id` (nullable FK, `ON DELETE SET NULL`);
`integrations.downlink_mode`, `downlink_api_url`, and an encrypted
`downlink_api_key`. `devices.ttn_app_id` is reused rather than duplicated. No
backfill.

**Services** — `command_dispatch`, `ota_dispatch` (shares the transport),
`processor/mqtt_processor.py` (`ChirpStackBridge` gains a downlink path and
records the application id), the devices and integrations routers.

**Security** — the platform's first stored outbound secret. RLS is inert under
the application's database role, so a plaintext credential is readable by any
path that reaches the table. The storage decision is the substance of this
change, not a detail of it.

## Open Questions

- ~~Whether `ttn_app_id` should be renamed now that it holds ChirpStack
  application ids.~~ **Resolved (2026-08-04): renamed to `lorawan_app_id` by
  migration 032, in its own change.** The protocol, not the vendor, is the
  stable fact. Deferring it here was right — it touched 17 files across the
  API, processor, scripts and frontend, which is exactly the diff that should
  not ride along inside a change about downlink routing.
- Whether an MQTT downlink should wait for the broker's PUBACK before a command
  is marked `sent`. QoS 1 gives delivery to the *broker*, not to ChirpStack, so
  "sent" would still be weaker than it sounds.
