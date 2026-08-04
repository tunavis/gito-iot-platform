# Network servers, bindings and downlinks

How a device is reached, and why the answer has two independent halves.

## The shape of it

**Uplinks and downlinks are separate declarations.** Today's client publishes
uplinks to an MQTT broker we subscribe to, and accepts downlinks on that same
broker. The next client may push uplinks to an HTTP endpoint of ours and accept
downlinks only through a REST API — or accept none at all. Inferring the second
direction from the first is right for whoever is in front of you and wrong for
whoever is next.

There is no direct connection to ChirpStack in the MQTT case. It publishes to a
broker; we subscribe. Because its MQTT integration is bidirectional, we publish
downlinks back to the same broker. **No ChirpStack API token is involved**, which
matters: that token carries authority over every device on the server.

## Adding a network server

### 1. The integration row

One per network server, per tenant. For the MQTT case the broker already lives in
`config` — the same one uplinks arrive on:

```json
{"broker_url": "mqtt.example", "port": 2883, "tls": false}
```

Add `username`/`password` if the broker is not anonymous.

### 2. Declare the downlink mode

`integrations.downlink_mode` is **required before anything can be sent** and is
validated on write and by a database constraint:

| mode | needs | credential |
|---|---|---|
| `mqtt` | `broker_url` in `config` | none, or a broker password |
| `rest` | `downlink_api_url` | a network-server API token |
| `none` | nothing | nothing |

`none` is an answer, not an absence. Use it for a client who forwards uplinks and
grants nothing back — commands to their devices are then **refused when issued**,
naming the server. Without it, a command queues, waits out its response window
(up to twelve hours for a B METERS IWM) and is recorded `timed_out`, which claims
the meter stayed silent when it was never asked.

`NULL` is different: it means nobody has configured this yet.

### 3. Bind the devices

`devices.integration_id`. Unbound devices keep the pre-binding behaviour
exactly — device attributes, then the platform-wide setting — so nothing already
working changes.

**A bound device never falls back.** If its server is missing, disabled or
misconfigured, the command fails with that reason and nothing is dispatched
anywhere. Falling back would send it to *a* server — the wrong one — and report
success.

See what is bound and what is not:

```
docker exec -i gito-api python < scripts/network_server_bindings.py
```

It proposes bindings from observed uplinks and **applies nothing**. A wrong
binding dispatches confidently to the wrong place, and a person is the only check
against that.

### 4. The application (MQTT mode)

The topic is `application/{application_id}/device/{dev_eui}/command/down`, so the
application id is required. It is captured automatically from each uplink into
`devices.lorawan_app_id` — provider-agnostic; ChirpStack, TTN, Helium and
Actility all populate the same column. (It was called `ttn_app_id` until
migration 032, which is worth knowing when reading older commits: it never held
a TTN id in this deployment.)

An **observed** value wins over a hand-entered one: the device is the authority on
where it reports from, and addressing a downlink to where someone *believed* it
was puts the frame in the wrong application. Setting it by hand exists to seed a
device that has not yet transmitted.

## Credentials

Stored on the integration, never on devices — one credential per server rather
than one per device, so rotating it is one edit rather than sixty-eight.

Encrypted at rest by `EncryptedString`, a **column type** rather than a helper:
there is no write path that can store plaintext, because the type encrypts on the
way in. Reads return a mask.

Set `SECRET_ENCRYPTION_KEY` in the environment — there is deliberately **no
default** in `docker-compose.yml`, because a generated fallback would mean every
deployment that forgot silently shares a key, and a rebuild would rotate it.

```
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### Runbook: the key is lost

**This is an outage, not data loss.** Credentials are re-enterable; nothing
irreplaceable is encrypted with this key.

Symptoms: the API **refuses to start** while encrypted credentials exist and the
key is absent. That is deliberate — booting anyway would mean every downlink
fails at the moment somebody needs one, from a service reporting itself healthy.

Recovery, in order of preference:

1. **Restore the key** from wherever `.env` is backed up. Nothing else to do.
2. **Clear and re-enter.** Set `downlink_api_key = NULL` on every integration,
   set a fresh `SECRET_ENCRYPTION_KEY`, start the API, and re-enter each
   credential from the network server's own console.

A key that is merely *changed* rather than lost gives `SecretCorrupt` on read —
"stored secret could not be decrypted" — rather than silence. Re-enter rather
than guessing which key was in use.

## What is not here yet

**The HTTP uplink webhook.** A client whose ChirpStack can only POST to us has no
route in this platform. The inbound credential mechanism exists —
`integrations._generate_key()` issues a key and stores its hash — but the
endpoint does not.

**OTA over MQTT.** Firmware dispatch resolves through the same binding, but its
payloads are not driver-encoded and have no MQTT shape. An `mqtt`-bound device is
told so plainly rather than having its image posted to a REST default that would
be a different server.

## Queue expiry: the one thing that cannot be made right

ChirpStack holds a queued downlink **indefinitely** unless an expiry was set
(`Expires at: Never` in its Queue tab), while our command expires on its own
window. So a command marked `timed_out` can still be delivered days later, when
the meter next wakes.

**Over MQTT this cannot be fixed.** The queue-item expiry added in ChirpStack
v4.10.1 is settable through its gRPC/REST API only — not in the MQTT
`command/down` body — and there is no MQTT flush either. Confirmed against the
ChirpStack community forum, January 2025:

> "So either you send using MQTT but no expiration date, or you send using the
> API with an expiration date but no custom UUID."

So the platform does the only honest thing available: it says so. A timed-out
command carries

> The device did not answer within its response window. This does not revoke the
> downlink: a network server still holding it may deliver it when the device next
> wakes.

and the same wording reaches the device page and `get_command_status`, so an
operator and an agent are told the same thing. **`timed_out` means "no answer
yet", not "cancelled".**

Harmless for a read. For a write it is the difference between being told "this
did not happen", retrying, and having the original land afterwards — so plan
writes around it, and prefer read-modify-write commands that are safe to repeat.

Revoking properly would need ChirpStack's API — a token with authority over
every device on the server, which the MQTT path exists to avoid needing. That is
a trade to make deliberately if and when writes matter more than the smaller
credential surface, not a gap to close by reflex.
