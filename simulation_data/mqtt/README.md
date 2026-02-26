# MQTT Simulation Tools

Two standalone tools for getting telemetry into Gito without real hardware.

---

## Overview

| Tool | What it does | When to use |
|------|-------------|-------------|
| `simulator.py` | Reads devices from PostgreSQL and publishes **synthetic** telemetry to local Mosquitto | You want fake-but-realistic data for testing dashboards and alerts |
| `bridge_ui.py` | Connects to an **external** MQTT broker, discovers live topics, lets you create Gito devices, then forwards real payloads into local Mosquitto | You have a real device (or a public demo broker) and want its data in Gito |

Both tools publish to the same local Mosquitto broker using the same topic format that `mqtt_processor.py` expects, so the data pipeline is identical to production.

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

```bash
cd simulation_data/mqtt
pip install -r requirements.txt
```

Dependencies: `paho-mqtt`, `psycopg2-binary`, `PyYAML`, `flask`, `flask-socketio`, `eventlet`, `requests`

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

### Device Profiles

The simulator selects a telemetry profile based on the device type's `category` column:

| Category | Metrics |
|----------|---------|
| `sensor` (default) | `temperature` (°C), `humidity` (%), `battery` (%) |
| `gateway` | `cpu_usage` (%), `memory_usage` (%), `uptime_hours` |
| `meter` | `energy_kwh`, `power_w`, `voltage` (V) |
| `tracker` | `latitude`, `longitude`, `speed_kmh`, `battery` (%) |

- **Drift metrics** (temperature, power, etc.) — random walk within configured min/max
- **Drain metrics** (battery) — slowly decreases over time
- **Increment metrics** (energy_kwh, uptime_hours) — monotonically increasing counter

Set the category via the device type in the Gito UI. Devices with no device type use the `sensor` profile.

### Topic Format

```
{tenant_id}/devices/{device_id}/telemetry
```

Payload is a flat JSON object of metric key → numeric value:
```json
{ "temperature": 22.5, "humidity": 58.3, "battery": 96.1 }
```

### Lifecycle

- New device created in the app → detected within `device_check_interval` seconds → simulation starts automatically
- Device deleted or set to `error` status → simulation stops automatically

### Sample Log Output

```
12:30:00  INFO     IoT Device Simulator starting ...
12:30:00  INFO     Connected to database
12:30:00  INFO     Connected to MQTT broker
12:30:00  INFO       Simulating: Warehouse Sensor A        (sensor)
12:30:00  INFO       Simulating: Main Gateway              (gateway)
12:30:30  INFO       Warehouse Sensor A             temperature=22.5  humidity=58.3  battery=96.1
12:30:30  INFO       Main Gateway                   cpu_usage=34.2  memory_usage=51.0  uptime_hours=127.4
12:30:40  INFO       Simulating: New Office Sensor         (sensor)
```

---

## Tool 2: MQTT Bridge UI (`bridge_ui.py`)

A web-based tool that connects to any external MQTT broker, shows you live topics, lets you create a Gito device for each topic, and forwards the real payloads into local Mosquitto.

### Usage

```bash
python bridge_ui.py
# Open http://localhost:5555
```

### Workflow (4 steps in the UI)

**Step 1 — Connect external broker**
Enter any MQTT broker host/port (defaults to `test.mosquitto.org:1883`). Optionally narrow topics with a filter (e.g. `sensors/#`). Click Connect.

**Step 2 — Log in to Gito**
Enter your Gito URL, email and password. The bridge calls the Gito API to authenticate and discover your device types.

**Step 3 — Browse topics**
All topics received from the external broker appear in the left sidebar in real time. Click a topic to inspect its payload, see the parsed metrics, and preview what will be forwarded.

**Step 4 — Create device & start bridge**
Fill in a device name (auto-suggested from the topic path), optionally select a device type and location, then click **Create Device & Start Bridge**. The bridge:
1. Creates the device in Gito via the API
2. Starts forwarding every message from that external topic to local Mosquitto as `{tenant_id}/devices/{device_id}/telemetry`

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

```bash
docker build -t gito-mqtt-bridge .
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
- Check logs for connection errors

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