# Platform-Side LoRaWAN Payload Decoding — Phase 1 (Complete)

**Status:** ✅ Shipped 2026-07-08 · Plan: `you-are-a-professional-sequential-frost` (safe/phased/team-authored)

## Problem

51 registered water meters were transmitting live, but zero telemetry was stored. The
ChirpStack bridge dropped every uplink with no NS-decoded `object` field, with no
persistence and no `last_seen` update — devices looked "never seen" forever even while
actively sending data. Root cause: the customer's ChirpStack has no payload codec
configured, and Gito had no ability to decode payloads itself.

## What shipped

**`shared/payload_codec/`** — pure declarative byte-layout decoder (38 tests, TDD'd like
`alarm_core`). No code execution, ever: `{"type": "declarative", "fields": [{"name",
"offset", "length", "type": uint8/int8/uint16/int16/uint32/int32/float32, "endian",
"scale", "value_offset"}], "f_port": optional}`. A malformed spec or field never raises —
returns `{}`/skips, same contract as `alarm_core.evaluate`.

**`raw_uplinks` table** (migration 022) — every LoRaWAN uplink's raw bytes are now
persisted regardless of decode outcome (`decoded: bool`, `codec_used: 'ns' | 'declarative'
| NULL`), tenant-scoped (RLS + explicit filter). Enables re-decode over history once a
decoder is authored or fixed.

**`device_types.decoder`** (JSONB, alongside the existing `key_mapping`) — team-authored
per device type. Fixed a real bug found during this work: `create_device_type`'s
constructor silently dropped `key_mapping`/`command_schema` (only `update` persisted
them) — `decoder` was added correctly and the pre-existing two were fixed in the same
edit.

**Wired at both ingest edges** (processor's ChirpStack-MQTT handler + the API's LoRaWAN
webhook router), same rule at each: NS `object` always wins (never double-decode); if
absent, try the device type's decoder against the raw payload; either way, persist raw
bytes and mark the device online — a device that's transmitting is never "never seen"
again, decoded or not.

**Minimal UI** — a "Payload Decoder" section in Device Type edit (byte-field table:
name/offset/length/type/endian/scale/±offset), no code editor, matches the plan's Phase 1
scope exactly.

## Verified end-to-end (real containers, real DB, both ingest paths)

| Scenario | Path | Result |
|---|---|---|
| No NS object, no decoder | processor (local broker) | raw captured, `decoded=false`, device flips online, zero telemetry |
| Decoder configured, same bytes replayed | processor | `flow_rate=42.5, temperature=19.3, cumulative_volume=15234` — exact match to the crafted spec |
| NS object present (different values) despite decoder configured | processor | NS values used verbatim (`999.9/1.1/777`), `codec_used='ns'` — decoder correctly skipped, no double-decode |
| No NS object, decoder configured | webhook (`POST /ingest/lorawan/chirpstack`) | same 3 metrics decoded correctly, `codec_used='declarative'`, integration `message_count` still bumped |
| Payload too short to decode | webhook | **201, `{ingested:0, decoded:false}`** — no more 400; this was the original pain point |

**Unplanned bonus validation:** mid-testing, the *real* production ChirpStack bridge
delivered live uplinks for two actual customer devices (`Flow Meter 93CA`, `Flow Meter
859F`). The new code correctly captured their raw bytes and flipped them online —
first-contact validation on real hardware, not just synthetic tests.

## Explicitly deferred (Phase 2, per the plan)

Sandboxed JS `decodeUplink` (LoRa-Alliance format) for tenant-self-service vendor codecs —
behind the same `payload_codec` interface, only when real self-service demand appears.
Phase 1's raw storage is the prerequisite that makes Phase 2 safe to add later (re-decode
history through a new codec).

## Next customer-facing step

Author the real Flow Meter decoder spec once the actual byte layout is known (capture a
raw payload from `raw_uplinks` for one of the live devices, work out the manufacturer's
format, set it via the Device Type UI). Everything downstream — telemetry storage, alarms,
the water-meter digital twin — already works; it was proven with a synthetic spec in this
verification pass.
