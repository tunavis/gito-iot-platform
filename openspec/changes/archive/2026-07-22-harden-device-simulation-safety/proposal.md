## Why

Fixture mode (`add-vendor-payload-simulator`) picked "any existing device of the
requested type" to publish synthetic uplinks as. In this environment that included
real, currently-reporting B METERS meters — running it once overwrote 9 days of a
real device's genuine telemetry history with disconnected synthetic values (a
physically impossible 479,000L drop) and fired 2 false CRITICAL alarms. The data
was recovered by hand from the surviving real rows, but the underlying capability
had no way to distinguish "safe to simulate" from "a real customer's meter" — it
was luck, not design, that this was caught immediately. Separately, the tool was
reported hard to get running (manual dependency install, a config-guessed Gito URL
that has been wrong more than once this session) — friction that matters because
this is meant to be the repeatable way the team proves every future vendor decoder,
not a one-off script.

## What Changes

- **BREAKING**: the simulator (continuous mode and fixture mode alike) now only
  ever operates on devices tagged `simulated` — enforced in `simulator.py`'s own
  device query, not just the UI. A device created any other way, including every
  real device already in this database, is invisible to it. Any previously-relied-on
  behavior of "simulate every device" no longer applies to untagged devices.
- New `POST /api/simulator/create-device` (bridge_ui.py): the only supported way
  to get a device the simulator can use. Creates a real device via the existing
  Gito device API, tagged `simulated`, with an auto-generated `dev_eui` for
  LoRaWAN types (retried on the astronomically unlikely uniqueness collision).
- New `GET /api/simulator/devices` and `POST /api/simulator/delete-device` — list
  and remove simulator devices; delete refuses (403) anything not tagged
  `simulated`, even if asked.
- `simulator.py --fixture` gains an optional `--device-id` to target one specific
  simulator device when more than one exists for a type; without it, picks one of
  the (already-safe) tagged candidates.
- Bridge UI: Step 5 ("Test Fixtures") replaced with "Simulator Devices" — pick a
  device type, see existing simulator devices for it with per-device send/delete
  actions, or create a new one. This is the guided, step-by-step flow requested.
- New `GET /api/detect-gito-url`: probes a short list of local candidates against
  `/api/health` and returns whichever answers, so the login form pre-fills
  correctly without the user needing to know internal port numbers.
- New `start.sh` / `start.bat`: one command installs dependencies and launches
  the Bridge UI.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `device-simulation`: the "LoRaWAN device types simulate through the real
  ChirpStack ingest path" and related requirements are unchanged in mechanism,
  but device *eligibility* is now scoped to simulator-created devices only —
  this is a new, safety-critical requirement, not a refinement of an existing one.

## Impact

- `simulation_data/mqtt/simulator.py` — `_DEVICE_QUERY` tag filter, `--device-id`
  threaded into fixture mode.
- `simulation_data/mqtt/bridge_ui.py` — 4 new endpoints (create/list/delete
  simulator device, detect-gito-url).
- `simulation_data/mqtt/templates/index.html` — Step 5 rebuilt as a device
  creation/management wizard; Gito URL auto-fill on load.
- `simulation_data/mqtt/start.sh`, `start.bat` — new.
- `simulation_data/mqtt/README.md` — Safety section, Managing Simulator Devices
  section, updated workflow steps.
- No API/database schema changes — uses the existing `devices.tags` (JSONB) column
  and the existing device create/get/delete endpoints exactly as designed.
