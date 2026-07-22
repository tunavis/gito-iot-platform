## 1. Safety filter

- [x] 1.1 Add `tags @> '["simulated"]'` to `simulator.py`'s `_DEVICE_QUERY`,
      covering both continuous sync and fixture mode (they share the query).
- [x] 1.2 Update the module docstring and the "no device found" error message
      to state the safety boundary explicitly and point at device creation.
- [x] 1.3 `--fixture` gains optional `--device-id` to target one specific
      simulator device when more than one exists for a type.

## 2. Backend: simulator device management

- [x] 2.1 `POST /api/simulator/create-device` — loads the device type to get
      its protocol/name, generates a name if omitted, auto-generates `dev_eui`
      for `lorawan` types (retry up to 3x on a 409 collision), tags
      `["simulated"]`, creates via the real device API.
- [x] 2.2 `GET /api/simulator/devices?device_type_id=` — lists tagged devices,
      paginating through the real API's `per_page`-capped results rather than
      assuming the whole fleet fits on one page (this tenant has 67+ real
      devices before counting simulator ones).
- [x] 2.3 `POST /api/simulator/delete-device` — fetches the device first,
      refuses with 403 if not tagged `simulated`, otherwise deletes.
- [x] 2.4 `GET /api/detect-gito-url` — probes the config default plus common
      local alternates against `/api/health`, returns the first that responds.

## 3. UI: Simulator Devices wizard

- [x] 3.1 Step 5 relabeled "Simulator Devices"; device-type dropdown reused,
      now drives a device list fetch on change.
- [x] 3.2 Device list: name, `dev_eui`, per-row send-test-data (⚡) and delete
      (🗑) actions; empty state ("None yet — create one below").
- [x] 3.3 Create form: optional name input, "Create Simulator Device" button →
      `create-device` → refreshes the list.
- [x] 3.4 `sendTestData(deviceId)` replaces the old bare `runFixture()`, passing
      the specific `device_id` through to `/api/simulator/fixture`.
- [x] 3.5 `deleteSimDevice(deviceId)` — native `confirm()` before calling
      `delete-device`.
- [x] 3.6 `init()` calls `detect-gito-url` and pre-fills the login form before
      the user does anything.
- [x] 3.7 Step 4's description text updated to reflect that continuous
      simulation is now scoped to simulator-tagged devices only.

## 4. Onboarding

- [x] 4.1 `start.sh` / `start.bat` — install dependencies, launch `bridge_ui.py`,
      print the URL to open.

## 5. Verification

- [x] 5.1 Live end-to-end via Playwright: selected a device type with zero
      simulator devices, confirmed the empty-state message, created one
      (auto-generated name + `dev_eui`), sent test data at that specific
      device (confirmed via the logged `device_id`), deleted it, confirmed
      removal in the real database. Zero console errors throughout.
- [x] 5.2 Confirmed the device list correctly shows none of the 67 real
      devices for a type that also has real devices — proving the tag filter
      and the list endpoint agree.
- [x] 5.3 Found and fixed a real bug during verification: `/api/simulator/devices`
      requested `per_page=200`, exceeding the real API's `le=100` cap (422) —
      fixed by paginating instead of assuming one page suffices.
- [x] 5.4 README rewritten: Quick Start, a prominent Safety section naming the
      incident, Managing Simulator Devices section, updated workflow steps,
      new troubleshooting entries.
