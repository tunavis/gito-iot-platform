## 1. payload_codec.encode()

- [x] 1.1 Add `encode(decoder_spec: dict, values: dict) -> bytes` to
      `shared/payload_codec/payload_codec/engine.py`, covering every field type
      `decode()` supports: `uint8/16/32`, `int8/16/32`, `float32`, `bcd`,
      `bit`-within-a-byte, `endian`, `scale`/`value_offset`, and
      `scale_exponent_ref`/`scale_exponent_base`.
- [x] 1.2 Multiple `bit` fields at the same `offset` OR into one byte instead of
      overwriting each other.
- [x] 1.3 Out-of-range values (e.g. exceed a BCD field's digit count) raise
      instead of silently truncating.
- [x] 1.4 Round-trip tests in `shared/payload_codec/tests/test_engine.py`:
      `decode(spec, encode(spec, values)) == values` for the existing IWM-LR3/LR4
      BCD+VIF spec and the RFM-LR1 uint32+bit spec (both already in
      `_vendorPresets.ts`), plus a synthetic spec exercising every field type in
      one payload. (72/72 passing, including a real bug caught by the round-trip
      itself: an omitted `scale_exponent_ref` field needs to default to
      `scale_exponent_base` on encode, not just be left zero-filled, or the
      round trip silently mis-scales by 10^-19.)
- [x] 1.5 Export `encode` from the package's public surface alongside `decode`.

## 2. Synthetic value generation

- [x] 2.1 Add a `data_model`-driven value generator: numeric fields use
      `min_value`/`max_value` when present, a generic per-`type` default range
      otherwise; `boolean` fields default to rarely-true.
- [x] 2.2 Add optional `simulation` hint to the `DataModelField` TypeScript
      interface (`_types.ts`) and Pydantic schema (`api/app/schemas/
      device_type.py`) — per-field drift/increment/drain/rare_bit mode plus
      min/max. Stored inline on each `data_model` field (already JSONB) — no
      migration. Caught and fixed a real pre-existing bug in the process:
      `device_types.py`'s create/update handlers manually whitelist
      `data_model` field keys when persisting, so a new Pydantic field alone
      was silently stripped on save until `simulation` was added to both
      whitelists too (create ~line 148, update ~line 284).
- [x] 2.3 Simulator applies a `simulation` hint when present, generic defaults
      otherwise; both real vendor presets now carry one — RFM-LR1
      (`total_volume` increment, alarm bits rare) and IWM-LR3/LR4 (same, plus
      `vif_code` pinned at its base value so a drifting VIF code can't produce
      absurd exponent-scaled `total_volume` — see design.md addendum below).
- [x] 2.4 State continuity for monotonic/draining fields across publishes —
      per-device `_field_state` dict in `DeviceState`, same shape as the
      legacy profile's `self.values`.

## 3. Protocol publisher registry

- [x] 3.1 Define the publisher interface: `ProtocolPublisher.publish(mqtt_client,
      state) -> dict`.
- [x] 3.2 Registry `PUBLISHERS = {"mqtt": ..., "lorawan": ...}` keyed by
      `device_type.connectivity.protocol`.
- [x] 3.3 A device type whose protocol has no registered publisher is skipped
      in `sync_devices()` with a clear log line naming the missing protocol.
- [x] 3.4 Registry wired into the existing poll-interval device-discovery loop;
      device selection/lifecycle unchanged, only the publish step is dispatched.

## 4. LoRaWAN publisher (raw-payload)

- [x] 4.1 `LoRaWANPublisher` builds the synthetic ChirpStack envelope (`data`
      base64, `fPort` from `decoder.f_port`, `deviceInfo.devEui`, `rxInfo`/
      `txInfo` with plausible constant-range RSSI/SNR/frequency).
- [x] 4.2 Envelope has no `object` key at all (simplest way to guarantee the
      processor's declarative-decoder fallback runs — no need for the
      `NS_PLACEHOLDER_KEYS` case since there's nothing to placeholder).
- [x] 4.3 Publishes only via the `mqtt_client` passed in, which only ever
      connects using `config.yaml`'s `mqtt.local` section (`Simulator.
      connect_mqtt`) — no code path in the simulator reads the remote-broker
      config at all, so `mqtt.cordys.co.za` is structurally unreachable, not
      just avoided by convention.
- [x] 4.4 Verified end-to-end against the real RFM-LR1 device type/device in
      this environment (`--fixture e5f74cbc-... --count 3`): `raw_uplinks`
      shows `decoded=true, codec_used='declarative'`, `telemetry` shows the
      expected monotonically-increasing `total_volume` plus `__lora_rssi`/
      `__lora_snr`/`__lora_frequency` radio metadata, matching a real uplink
      exactly. (Alarm-row firing not separately re-verified — downstream
      `alarm_core` evaluation is unmodified code already proven on real
      telemetry; every alarm bit in the test happened to be False.)

## 5. Native MQTT publisher (flat-JSON)

- [x] 5.1 `MqttNativePublisher` uses the data_model-driven generator from
      section 2 for `mqtt`-protocol device types.
- [x] 5.2 Regression-checked directly (no `mqtt`-protocol devices exist yet in
      this environment to fixture-test): constructed a synthetic device-type
      row with no `data_model` at all and confirmed `DeviceState` falls back to
      the untouched legacy category-profile code path, producing the exact
      same metric set as before this change.

## 6. Fixture-replay CLI mode

- [x] 6.1 `--fixture <device-type-id>` / `--count N` (default 5) added; verified
      live (see 4.4) — publishes immediately via the registry-selected
      publisher, no poll-interval wait.
- [x] 6.2 Done under 8.1 — README's new **Fixture Mode** section covers usage
      and the worked RFM-LR1 example.

## 7. Simulator UI rebuild

- [x] 7.1 Real token values copied from `globals.css` into `templates/index.html`
      (`:root` + `@media (prefers-color-scheme: dark)`, matching the app's own
      `.dark` override values exactly) — light-first, dark-mode-aware. Verified:
      Tailwind CDN's opacity-modifier utilities (`bg-emerald-950/50` etc., used
      ~15 places in the old file) silently render fully transparent when the
      base color is a CSS-variable reference rather than a literal hex — tested
      empirically before committing to an approach. Used the file's own
      existing semantic-class pattern (`.btn-green`→`.btn-primary`, `.card`,
      `.input`, plus new `.tint-ok/-danger/-warn`, `.badge-*`, `.text-*`)
      instead of a blanket Tailwind config remap, since it doesn't hit that
      opacity trap and every color usage in the body only had to change once
      per semantic class, not per call site.
- [x] 7.2 Emoji replaced with an inline SVG symbol sprite (stroke-based,
      `currentColor`, matches Lucide's visual weight) — check, x, info, alert,
      link, chevron-up/down/right, play, square, refresh, trash, zap, send,
      activity, beaker. No CDN/build-step dependency added.
- [x] 7.3 New "Step 5: Test Fixtures" panel — device-type dropdown (shows each
      type's protocol inline, e.g. "B METERS RFM-LR1 (lorawan)"), count input,
      "Send Test Uplinks" button — added to the existing page alongside the
      broker-bridging workflow. New `/api/simulator/fixture` Flask endpoint
      (`bridge_ui.py`) runs `simulator.py --fixture` as a subprocess and
      returns its output, mirroring the existing `/api/simulator/start`
      subprocess pattern.
- [x] 7.4 Fixture output renders in a `.card` `<pre>` block styled like the
      existing raw-payload viewer.
- [x] 7.5 Verified live: started the real Flask server, screenshotted light
      and dark mode (both match the app's actual palette), logged in with the
      real Playwright test account, ran an actual fixture against the real
      RFM-LR1 device type through the UI — output showed 5 real uplinks with
      correctly monotonic `total_volume`. Caught and fixed a real pre-existing
      bug in the process: `bridge_ui.py`'s `_gito_base()` ignored the URL
      actually used at login and always fell back to `config.yaml`'s static
      default, so "logged in" and "device-types 404" could both be true at
      once in any environment where those differ (this one included) — now
      `gito_login()` stores the URL it actually succeeded against and
      `_gito_base()` prefers it.

## 8. Docs

- [x] 8.1 No new config.yaml keys needed — fixture mode reuses the existing
      `database`/`mqtt.local` sections. README rewritten: overview table,
      data-flow note, new **Protocols** section (publisher registry table +
      the "never touches the remote broker" guarantee), new **Synthetic
      Values** section (`data_model`-driven generation + the `simulation`
      hint table), new **Fixture Mode** section (CLI usage, a real worked
      RFM-LR1 example, the `raw_uplinks`/`telemetry` SQL to confirm it
      worked), Topic Format split into native vs. LoRaWAN, sample log output
      updated to the new `(category / protocol)` format, and a Step 5 entry
      for the Bridge UI's new Test Fixtures panel.
- [x] 8.2 Archived via `openspec archive add-vendor-payload-simulator -y` —
      `device-simulation` is now the 20th permanent capability in
      `openspec/specs/` (7 requirements merged), change folder moved to
      `openspec/changes/archive/2026-07-22-add-vendor-payload-simulator/`.
