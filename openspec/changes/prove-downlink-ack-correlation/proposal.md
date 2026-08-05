# Prove downlink acknowledgement correlation against real hardware

## Why

`bind-downlinks-to-their-network-server` shipped and was archived on 2026-08-05
with its headline proof only half done, and this change carries the other half
rather than leaving it as an unticked box inside an archive.

That change's section 8 — *"The proof this whole thing was for"* — sent
`get_fw_version` (`07 00 00 00 00`) to `e41e0a9000009390` over MQTT on a real
binding. `device_commands` holds exactly one row ever, and its final status is
**`timed_out`**: created 2026-08-03 12:28+00, expired against that device type's
`response_window_seconds` of 43200 (12 hours), with no answer.

So what is actually proven today is the **outbound** half: encode from the
driver declaration, resolve the device's binding, publish on the right topic at
fPort 1, and expire on the per-driver window rather than the retired 60s
default. That is real and it is not nothing.

What is **not** proven is correlation. `_correlate_driver_ack` in the processor
has never matched a real device answer on `(device, opcode)`. Neither has the
partial unique index `uq_device_commands_inflight_opcode` (migration 030) ever
refused a real second command, nor has any command reached `delivered` from
hardware. Every one of those paths is currently supported by unit tests and
synthetic frames alone.

The device chosen for the original proof cannot settle this. A B METERS IWM
reports every 12 hours and is NFC-settable only; it may never acknowledge a
downlink at all, so a timeout against it is not evidence either way. An RFM-LR1
echoes the whole frame back and refuses with `0x02 <Index>` — it is the device
class in this fleet that can actually demonstrate an answer being matched.

The risk of leaving this is specific: the platform reports `timed_out` for a
device that was asked and stayed silent, and would report the same thing if
correlation were broken. Those two are indistinguishable from the outside, which
is exactly the ambiguity the acknowledgement design was built to remove.

## What Changes

- Send one command to an RFM-LR1 and record the frame published, the frame
  returned, and the command's final status — the evidence task 8.2 could not
  produce.
- Confirm `_correlate_driver_ack` matches on `(device, opcode)` against that
  real answer, and that the command reaches a terminal status from hardware
  rather than from the timeout sweep.
- Confirm the in-flight unique index refuses a genuine second command on the
  same `(device, opcode)` while the first is outstanding.
- Record the negative result too: if an IWM provably cannot acknowledge, say so
  in its driver file so a future operator does not read `timed_out` as a fault.

**Out of scope:** any change to the encoding, binding, or transport code. This
change is verification. If it finds a defect, that defect gets its own change —
folding a fix into the proof is how a proof stops being one.

## Impact

- Affected specs: `network-server-binding`, `integrations-and-commands`
- Affected code: none expected. `drivers/b-meters-*.json` may gain a documented
  acknowledgement note.
- Affected operations: requires publishing to a live broker against a real
  meter, which is an operator action — `mqtt.cordys.co.za` is read-only to
  tooling and must stay that way.
