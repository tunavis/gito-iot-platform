# Tasks

## 1. Establish the baseline

- [ ] 1.1 Record the current state so the proof has a before: `device_commands`
      holds one row, opcode 7 to `e41e0a9000009390`, `timed_out`. Any new row is
      therefore unambiguously this change's.
- [ ] 1.2 Pick the RFM-LR1 to use and confirm it is bound, its integration's
      `downlink_mode` is `mqtt`, and its `lorawan_app_id` was observed from its
      own uplinks rather than hand-seeded. An unbound or hand-seeded device
      would prove the wrong thing.
- [ ] 1.3 Confirm the bridge is connected to that device's broker and the
      processor is consuming — a proof that fails because nothing was listening
      teaches nothing.

## 2. The outbound frame

- [ ] 2.1 Choose the command. It must be read-only and state-free on the meter,
      the way `get_fw_version` was — a proof that changes a meter's
      configuration is not one anybody will want to repeat.
- [ ] 2.2 Record the exact bytes the driver encodes and the topic they are
      published on, before publishing. The declaration is the thing under test;
      reading the bytes back afterwards is not the same evidence.

## 3. The answer

- [ ] 3.1 Publish it. **Operator action** — tooling here does not publish to
      `mqtt.cordys.co.za`.
- [ ] 3.2 Capture the raw frame the device returns, unparsed, before anything
      interprets it.
- [ ] 3.3 Confirm `_correlate_driver_ack` matched it on `(device, opcode)` and
      not on `command_id` — no third-party device echoes ours, and a match on
      the wrong key would pass this test while being wrong.
- [ ] 3.4 Confirm the command reached its terminal status from the answer, not
      from `expire_timed_out_commands`. Check the timestamp against the response
      window: a status that only arrives at the window boundary is the sweep
      wearing the answer's clothes.

## 4. The in-flight lock

- [ ] 4.1 With one command genuinely outstanding, issue a second on the same
      `(device, opcode)` and confirm `uq_device_commands_inflight_opcode`
      refuses it at the database rather than the router — two dispatches
      arriving together would both read "nothing outstanding".
- [ ] 4.2 Confirm a *different* opcode to the same device is still accepted, so
      the index is not over-broad.

## 5. Record what is true

- [ ] 5.1 Write the result into `openspec/specs/network-server-binding` as a
      scenario that reflects observed behaviour, not intended behaviour.
- [ ] 5.2 If the IWM provably cannot acknowledge a downlink, say so in
      `drivers/b-meters-iwm-lr3-lr4.json` where the next person will read it,
      so `timed_out` on that class is understood as expected rather than a
      fault to chase.
- [ ] 5.3 If any of this fails, do **not** fix it here. Open a change for the
      defect and leave this one recording what was observed.

## Blocked / awaiting external input

- [ ] 10.1 Tasks 3.1 onwards need an operator to publish to the live broker and
      an RFM-LR1 that is transmitting. Sections 1 and 2 are doable without
      either.
