# Milesight — payload codecs

<https://github.com/Milesight-IoT/SensorDecoders>

Milesight's own reference codecs for its LoRaWAN sensors, kept current by the
vendor (216★, last pushed 2026-07-31).

## Why it's here

It is the second vendor for
`openspec/changes/add-device-driver-model` (renamed from
`add-multi-protocol-command-codec` — the scope grew to cover uplink decode too,
because a command's acknowledgement arrives as an uplink). The change argues the
unit of declaration must be the **device type**, using B METERS as evidence that
one vendor's two product lines already share nothing. Milesight is the
cross-vendor check on that claim, and it ships the **downlink** half we're
missing: every device folder has an `*-encoder.js` beside the `*-decoder.js`, so
their command encoding is readable rather than guessed from a manual.

It also settled a design decision. Milesight ships **JavaScript**, as TTN and
ChirpStack vendors generally do, while our `DeviceType.decoder` is declarative
with no code execution. Declarative-only would mean hand-transcribing dozens of
models per vendor, so a driver's codec accepts both shapes — declarative where
it suffices, and a sandboxed script path for a vendor's own file used unmodified.
See the proposal for the sandbox requirements, which are not optional in a
multi-tenant deployment where RLS is inert.

## Layout

One folder per series (`am-`, `ct-`, `em-`, `gs-`, `uc-`, `ws-`, `wt-`, …), then
one per model, e.g. `ws-series/ws523/`:

| File | What it is |
| --- | --- |
| `ws523-decoder.js` | uplink bytes → JSON |
| `ws523-encoder.js` | downlink command → bytes |
| `ws523-codec.json` | the pair bundled as a TTN/ChirpStack payload formatter |
| `README.md` | the per-model channel/opcode table |

`LoRaObject.md` at the repo root documents the JSON shape the decoders emit.

## Before copying anything in

**GPL-3.0.** Read as a reference; vendoring these files into `shared/payload_codec`
is a licensing decision, not a convenience.

Worth knowing: the script codec path avoids the question rather than answering
it. GPL obligations attach on *distribution* — a customer supplying the vendor's
codec into their own device type at runtime means we never ship it. That is an
argument for runtime codecs on top of the friction one, not a workaround.
