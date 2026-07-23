# MQTT Simulation Tools

Two standalone tools for getting telemetry into Gito without real hardware.

## Quick Start

```bash
cd simulation_data/mqtt
./start.sh          # Windows: start.bat
# Open http://localhost:5555
```

That installs/updates dependencies and launches the Bridge UI, which hosts everything —
including the simulator's controls. The Gito URL field pre-fills itself with whatever
actually answers on this machine; you shouldn't need to know internal port numbers.

## Safety — read this before using the simulator

**The simulator will only ever publish as a device it created itself** (tagged `simulated`
via the **Simulator Devices** tab). It will never pick, and never overwrite the history of,
an existing device — including a real one that happens to share a device type with what
you're testing.

This isn't a hypothetical: earlier versions of fixture mode picked "any existing device of
this type" and once overwrote 9 days of a real meter's real telemetry history with synthetic
data, and fired 2 false CRITICAL alarms in the process. If you ever find yourself pointing
this tool at a device you didn't create through it — stop; that's the bug this section exists
to prevent.

---

## Overview

| Tool | What it does | When to use |
|------|-------------|-------------|
| `simulator.py` | Reads devices from PostgreSQL and publishes **synthetic** telemetry to local Mosquitto, via each device type's own protocol | You want fake-but-realistic data for testing dashboards and alerts — or you're proving a newly-authored decoder works |
| `bridge_ui.py` | Connects to an **external** MQTT broker, discovers live topics, lets you create Gito devices, then forwards real payloads into local Mosquitto. Also hosts the simulator's controls (start/stop, fixture-replay) as a web UI | You have a real device (or a public demo broker) and want its data in Gito |

Both tools publish to the same local Mosquitto broker using the same topics `mqtt_processor.py` expects in production, so the data pipeline is identical — nothing downstream can tell a simulated uplink from a real one.

**Data flow:**
```
simulator.py          →  Local Mosquitto  →  mqtt_processor  →  DB + Redis + WebSocket
External MQTT broker  →  bridge_ui.py    →  Local Mosquitto  →  mqtt_processor  →  DB + Redis + WebSocket
```

---

## Prerequisites

- Python 3.10+
- Local Mosquitto running (via `docker-compose up`)
- PostgreSQL running with the Gito database (simulator.py only)
- Gito API running (bridge_ui.py only)

---

## Installation

`./start.sh` / `start.bat` (see Quick Start above) does this for you. To do it by hand instead:

```bash
cd simulation_data/mqtt
pip install -r requirements.txt
```

Dependencies: `paho-mqtt`, `psycopg2-binary`, `PyYAML`, `flask`, `flask-socketio`, `eventlet`, `requests`,
plus a local editable install of `shared/payload_codec` (already in `requirements.txt` as
`-e ../../shared/payload_codec`).

---

## Configuration

Edit `config.yaml` before running either tool:

```yaml
database:          # simulator.py reads devices from here
  host: localhost
  port: 5432
  database: gito
  user: gito
  password: dev-password

mqtt:
  local:           # both tools publish to this broker
    host: 127.0.0.1
    port: 1883
    username: ""   # leave blank for anonymous Mosquitto
    password: ""
  demo:            # default external broker for bridge_ui.py
    host: test.mosquitto.org
    port: 1883

bridge:
  gito_api_url: http://127.0.0.1   # where bridge_ui.py calls the Gito API
  gito_email: ""                    # pre-fill login form (optional)
  ui_port: 5555                     # port for bridge_ui web interface

simulator:
  publish_interval: 30       # seconds between telemetry publishes
  device_check_interval: 10  # seconds between DB scans for new/removed devices
```

---

## Tool 1: Device Simulator (`simulator.py`)

Polls the database every N seconds, auto-discovers active devices, and publishes realistic synthetic telemetry.

### Usage

```bash
# Simulate all active devices in the database
python simulator.py

# Simulate a single device
python simulator.py --device-id <uuid>

# Custom publish interval (seconds)
python simulator.py --interval 10

# Custom config file
python simulator.py --config /path/to/config.yaml
```

### Protocols

The simulator picks a **publisher** based on each device type's own `connectivity.protocol` —
not a hardcoded list of categories. Two are implemented:

| Protocol | What gets published | Where |
|----------|---------------------|-------|
| `mqtt` (native) | Flat JSON, one key per metric | `{tenant_id}/devices/{device_id}/telemetry` |
| `lorawan` | Real bytes, encoded via the device type's own `decoder` spec, wrapped in a synthetic ChirpStack uplink envelope | `application/simulator/device/{dev_eui}/event/up` |

A `lorawan` device's payload goes through `payload_codec.encode()` → base64 → a fake ChirpStack
`{data, fPort, deviceInfo, rxInfo, txInfo}` envelope with no `object` key, so `mqtt_processor.py`
falls through to the device type's own declarative decoder — the *exact* code path a real
ChirpStack uplink takes, including dedup, rate-limiting, and alarm evaluation. This never touches
the real `mqtt.cordys.co.za` broker; it only ever connects to `config.yaml`'s `mqtt.local` section.

A device type on a protocol with no registered publisher (e.g. `modbus`, `http` — recognized by
the platform but not yet simulatable) is skipped with a log line naming the missing protocol, not
a crash. Adding a new protocol means writing one `ProtocolPublisher` subclass and registering it
in `PUBLISHERS` — nothing else in `simulator.py` changes.

### Synthetic Values

Every metric's synthetic value comes from that field's own entry in the device type's
`data_model` (`type`, `unit`, `min_value`, `max_value`), not a hardcoded per-category table — so
it covers any device type, including ones with wildly different fields under the same broad
`category` (a water-flow meter and an energy meter are both `category: meter`, but nothing alike).

A field can optionally carry a `simulation` hint (set on the `VendorPreset` in
`_vendorPresets.ts`, or directly on a device type's `data_model` field):

```json
{ "name": "total_volume", "type": "float", "min_value": 5000, "max_value": 200000,
  "simulation": { "mode": "increment", "min": 5000, "max": 200000 } }
```

| `mode` | Behavior | Typical use |
|--------|----------|-------------|
| `drift` (default for numeric) | Random walk within min/max | temperature, pressure |
| `increment` | Monotonically increasing, starts somewhere in min/max | a volume/energy counter |
| `drain` | Starts high, slowly decreases toward min | battery |
| `rare_bit` (default for boolean) | Almost always `false` | an alarm flag |

No `simulation` hint at all is completely normal — every `boolean` field defaults to rarely-true,
every numeric field drifts within `min_value`/`max_value` (or a generic 0–100 range if neither is
set). A hint is an enhancement a vendor preset can opt into, never a prerequisite for simulating
that device type.

Devices with **no device type** (or an empty `data_model`) fall back to the original
category-based profile below, unchanged:

| Category | Metrics |
|----------|---------|
| `sensor` (default) | `temperature` (°C), `humidity` (%), `battery` (%) |
| `gateway` | `cpu_usage` (%), `memory_usage` (%), `uptime_hours` |
| `meter` | `energy_kwh`, `power_w`, `voltage` (V) |
| `tracker` | `latitude`, `longitude`, `speed_kmh`, `battery` (%) |

### Fixture Mode — proving a decoder without real hardware

```bash
python simulator.py --fixture <device-type-id> --count 5
python simulator.py --fixture <device-type-id> --device-id <uuid> --count 5   # a specific one
```

Publishes N synthetic uplinks for **one** device type immediately (via whichever publisher its
protocol resolves to) and exits — no waiting on the poll interval, no real device required.

**This requires a simulator device to already exist for that type — it will error rather than
fall back to a real one.** Create one first via the Bridge UI's **Simulator Devices** tab
or `POST /api/simulator/create-device` — see **Managing Simulator Devices** below.
This is the repeatable replacement for hand-writing a throwaway decode script every time a new
vendor preset is authored:

```
$ python simulator.py --fixture e5f74cbc-1244-40a6-977b-8f3563d7948a --count 3
15:07:43  INFO     Publishing as: SIM - B METERS RFM-LR1 - a3f2  (meter / lorawan)
15:07:43  INFO       [1/3]  total_volume=160217.109  flow_exceeds_q3_alarm=False  ...
15:07:44  INFO       [2/3]  total_volume=163053.818  flow_exceeds_q3_alarm=False  ...
15:07:45  INFO       [3/3]  total_volume=166166.049  flow_exceeds_q3_alarm=False  ...
15:07:45  INFO     Done. Check `telemetry`/`raw_uplinks` for device 12b930fc-... to confirm
                    the decoder produced the expected fields.
```

Then confirm the decoder actually worked — `raw_uplinks.codec_used` should read `declarative`
(not empty), and `telemetry` should show the fields the decoder was supposed to produce:

```sql
SELECT raw_b64, decoded, codec_used FROM raw_uplinks WHERE device_id = '...' ORDER BY ts DESC LIMIT 3;
SELECT metric_key, metric_value FROM telemetry WHERE device_id = '...' ORDER BY ts DESC LIMIT 10;
```

The same flow is available from the **Simulator Devices** tab in the Bridge UI (Tool 2) — for
anyone who'd rather not use a terminal.

### Managing Simulator Devices

Devices the simulator is allowed to touch are created through one path only — never by tagging
an existing device by hand. Three endpoints (used by the Bridge UI's **Simulator Devices** tab,
and callable directly):

| Endpoint | What it does |
|----------|-------------|
| `POST /api/simulator/create-device` | `{device_type_id, name?}` — creates a new device tagged `simulated`, auto-generating a `dev_eui` for `lorawan` types. Returns the created device. |
| `GET /api/simulator/devices?device_type_id=` | Lists devices tagged `simulated`, optionally filtered to one type. |
| `POST /api/simulator/delete-device` | `{device_id}` — deletes it. Refuses (403) if the device isn't tagged `simulated`, even if asked. |

`simulator.py`'s own device query (`_DEVICE_QUERY`) filters on `tags @> '["simulated"]'` — this
is the actual enforcement point, not the UI. Calling the real device-create API directly with a
hand-added `simulated` tag works exactly the same as going through the panel; there's no
separate "trusted" code path.

### Topic Format

Native MQTT devices:
```
{tenant_id}/devices/{device_id}/telemetry
```
Payload is a flat JSON object of metric key → numeric value:
```json
{ "temperature": 22.5, "humidity": 58.3, "battery": 96.1 }
```

LoRaWAN devices publish a synthetic ChirpStack envelope instead — see **Protocols** above.

### Lifecycle

- New simulator device created (Simulator Devices tab or the API) → detected within `device_check_interval` seconds → continuous simulation starts automatically
- Simulator device deleted or set to `error` status → simulation stops automatically
- A device created any other way is never picked up, regardless of status — see **Safety** above

### Sample Log Output

```
12:30:00  INFO     IoT Device Simulator starting ...
12:30:00  INFO     Connected to database
12:30:00  INFO     Connected to MQTT broker
12:30:00  INFO       Simulating: Warehouse Sensor A        (sensor / mqtt)
12:30:00  INFO       Simulating: Water Meter 4371          (meter / lorawan)
12:30:00  INFO       Skipping Legacy Modbus Gauge: no simulator publisher registered for protocol 'modbus'
12:30:30  INFO       Warehouse Sensor A             temperature=22.5  humidity=58.3  battery=96.1
12:30:30  INFO       Water Meter 4371                total_volume=160217.1  removal_alarm=False  ...
12:30:40  INFO       Simulating: New Office Sensor         (sensor / mqtt)
```

---

## Tool 2: MQTT Bridge UI (`bridge_ui.py`)

A web-based tool that connects to any external MQTT broker, shows you live topics, lets you create a Gito device for each topic, and forwards the real payloads into local Mosquitto.

### Usage

```bash
python bridge_ui.py
# Open http://localhost:5555
```

### Workflow

You sign in once (Gito URL, email, password — matches the real app's login page) and land on
two tabs. They're independent tools, not sequential steps — pick the one you need:

**Tab: Simulator Devices** (the default landing tab — this is the day-to-day workflow: create
a dedicated test device for a device type and prove its decoder works, without touching real
hardware or real devices)
1. A compact **Continuous simulation** control bar at the top starts/stops the timer-driven
   publisher for every simulator device that already exists.
2. Pick a device type from the dropdown (shown with its protocol, e.g. "B METERS RFM-LR1 (lorawan)").
3. The left card lists any simulator devices that already exist for it — each has a **⚡ send
   test data** button and a **🗑 delete** button.
4. Or create a new one on the right: an optional name (auto-generated if left blank), then
   **Create Simulator Device**. This calls the real device-creation API with a `simulated` tag
   and, for `lorawan` types, a fresh random `dev_eui` — it is a completely new device, never an
   existing one.

Clicking **send test data** runs `simulator.py --fixture` against that specific device and shows
the log output inline — the UI equivalent of Fixture Mode above, for proving a decoder works
without a terminal. See **Safety** at the top of this file for why this tab exists in this shape.

**Tab: Bridge External Device** (the occasional workflow: import a real device's telemetry from
an external MQTT broker)
1. **Connect external broker** — enter any MQTT broker host/port (defaults to
   `test.mosquitto.org:1883`). Optionally narrow topics with a filter (e.g. `sensors/#`). Click
   Connect.
2. **Browse topics** — every topic received from the external broker appears in the left
   sidebar in real time. Click one to inspect its payload, see the parsed metrics, and preview
   what will be forwarded.
3. **Create device & start bridge** — fill in a device name (auto-suggested from the topic
   path), optionally select a device type and location, then click **Create Device & Start
   Bridge**. The bridge creates the device in Gito via the API, then starts forwarding every
   message from that external topic to local Mosquitto as `{tenant_id}/devices/{device_id}/telemetry`.
4. Previously bridged devices are listed in the **Bridges** strip at the bottom — **Resume** to
   restart forwarding after a restart, without re-creating the device.

### Saved Bridges

Bridges are persisted to `saved_bridges.json`. After restarting the UI, connect to the broker, log in to Gito, then click **Resume** on any saved bridge to re-activate it without re-creating the device.

### Payload Handling

- JSON objects → flattened to `metric_key: value` pairs
- Plain numeric payloads (e.g. a sensor publishing just `22.5`) → wrapped using the last segment of the topic as the key
- String and boolean values are forwarded as-is; `mqtt_processor` stores them in the appropriate column
- Keys are sanitized to `[a-zA-Z0-9_]` (spaces and hyphens become underscores)

### Environment Variable Overrides

Useful when running in Docker or CI:

| Variable | Overrides |
|----------|-----------|
| `GITO_API_URL` | `bridge.gito_api_url` in config.yaml |
| `MQTT_LOCAL_HOST` | `mqtt.local.host` |
| `MQTT_LOCAL_PORT` | `mqtt.local.port` |
| `UI_PORT` | `bridge.ui_port` (default 5555) |

### Docker

The build context is the **repo root**, not this directory — the Dockerfile
pulls in `shared/payload_codec` the same way `api`/`processor` do, so a
context scoped to just `simulation_data/mqtt` can't see it:

```bash
cd ../..   # repo root
docker build -t gito-mqtt-bridge -f simulation_data/mqtt/Dockerfile .
docker run -p 5555:5555 \
  -e GITO_API_URL=http://host.docker.internal \
  -e MQTT_LOCAL_HOST=host.docker.internal \
  gito-mqtt-bridge
```

---

## Utility: `discover_demo_devices.py`

One-shot script that subscribes to `test.mosquitto.org/#` for 30 seconds and prints all discovered topics. Useful for finding public demo topics to bridge.

```bash
python discover_demo_devices.py
```

---

## Troubleshooting

### Simulator: no devices detected
- Verify PostgreSQL connection in `config.yaml` (database name is `gito`, not `gito_iot`)
- Devices with `status = 'error'` are excluded — check device status in the UI
- **Only devices tagged `simulated` are ever eligible** — see Safety, above. If you expected an
  existing device to show up here, it won't; create a simulator device instead
- Check logs for connection errors

### Fixture mode / "Send test data": "No simulator device exists for this type yet"
- Exactly what it says — create one first via the **Simulator Devices** tab or `POST /api/simulator/create-device`
- This is not a bug to work around by pointing it at a real device — see Safety, above

### No data appearing in Gito
1. Confirm local Mosquitto is running: `docker-compose ps`
2. Confirm `mqtt_processor` is running: `docker-compose logs -f processor`
3. Verify topic format: `{tenant_id}/devices/{device_id}/telemetry`
4. Check that the tenant_id and device_id in the topic match real records in the DB

### Bridge UI: "Local Mosquitto offline"
- Mosquitto must be reachable at `mqtt.local.host:port` in config.yaml
- On Windows the bridge resolves hostnames explicitly to work around DNS issues in background threads — use `127.0.0.1` instead of `localhost` if connection fails

### Bridge: no metrics forwarded
- Open the topic in the UI and check the **Detected numeric metrics** panel
- If it shows 0 metrics, the payload has no numeric/string/boolean values the processor can store
- Non-parseable binary payloads are silently dropped

---

## Running as a Service

### Linux / macOS (systemd)

```ini
[Unit]
Description=Gito IoT Device Simulator
After=network.target postgresql.service

[Service]
Type=simple
User=your_user
WorkingDirectory=/path/to/simulation_data/mqtt
ExecStart=/usr/bin/python3 simulator.py
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable iot-simulator
sudo systemctl start iot-simulator
```

### Windows (Task Scheduler)

1. Open Task Scheduler → Create Basic Task
2. Trigger: At startup
3. Action: Start a program → `python`
4. Arguments: `C:\path\to\simulation_data\mqtt\simulator.py`