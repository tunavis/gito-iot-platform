# IoT Device Simulator

**Zero code changes required** - Standalone service that simulates realistic device telemetry.

## 🎯 How It Works

1. **You create a device in your web app** (normal workflow)
2. **Simulator detects it** (polls database every 10 seconds)
3. **Starts sending data automatically** (publishes to local Mosquitto)
4. **Your existing code processes it** (mqtt_processor.py picks it up)
5. **Data appears in dashboard** (exactly like a real device)

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd simulation_data/mqtt
pip install -r requirements.txt
```

### 2. Configure (Optional)

Edit `config.yaml` if your database/MQTT settings are different:

```yaml
database:
  host: localhost
  port: 5432
  database: gito_iot
  user: postgres
  password: postgres

mqtt:
  local:
    host: localhost
    port: 1883
```

### 3. Run the Simulator

```bash
python simulator.py
```

### 4. Create a Device in Your App

- Go to your web app
- Create a new device (fill in name, type, location, etc.)
- **Within 10 seconds**, the simulator will detect it and start sending data!

## 📊 What Data Gets Simulated

- **Temperature**: 15-35°C with realistic trends
- **Humidity**: 20-90% (inversely correlated with temperature)
- **Battery**: Starts high, slowly drains
- **RSSI/SNR**: Network quality fluctuations
- **Counter**: Increments with each message

## 🎛️ Configuration Options

### Publish Interval
How often devices send data (default: 30 seconds)

```yaml
simulator:
  publish_interval: 30  # Send data every 30 seconds
```

### Device Check Interval
How often to scan database for new devices (default: 10 seconds)

```yaml
simulator:
  device_check_interval: 10  # Check every 10 seconds
```

### Telemetry Ranges
Customize realistic data ranges:

```yaml
telemetry:
  temperature:
    min: 15.0
    max: 35.0
  humidity:
    min: 20.0
    max: 90.0
```

## 🔄 Device Lifecycle

### Device Created in App
```
✅ Simulator detects new device
✅ Initializes realistic state
✅ Starts publishing data
📊 Data appears in dashboard
```

### Device Deleted from App
```
⚠️ Simulator detects removal
⚠️ Stops publishing data
✅ Cleans up resources
```

## 📝 Log Output

```
2026-02-08 14:30:00 - INFO - 🚀 IoT Device Simulator Starting...
2026-02-08 14:30:00 - INFO - Connected to database
2026-02-08 14:30:00 - INFO - Connected to local MQTT broker at localhost:1883
2026-02-08 14:30:00 - INFO - Found 3 active devices in database
2026-02-08 14:30:00 - INFO - Initialized state for device Warehouse Sensor (0004A30B001A2B3C)
2026-02-08 14:30:00 - INFO - Starting simulation loop...
2026-02-08 14:30:30 - INFO - Published data for Warehouse Sensor (temp: 22.5°C, humidity: 55.3%, battery: 98.5%)
2026-02-08 14:31:00 - INFO - 🟢 Started simulating new device: Office Temperature Monitor
```

## 🛠️ Troubleshooting

### Simulator Not Detecting Devices
- Check database connection in `config.yaml`
- Verify devices have `is_active = true`
- Check logs for errors

### No Data in Dashboard
- Verify local Mosquitto is running (`docker-compose ps`)
- Check MQTT topic format: `devices/{dev_eui}/up`
- Verify mqtt_processor.py is running
- Check processor logs: `docker-compose logs -f processor`

### Data Looks Unrealistic
- Adjust telemetry ranges in `config.yaml`
- Modify trend algorithms in `simulator.py`

## 🔧 Running as a Service

### Linux/macOS (systemd)
```bash
sudo nano /etc/systemd/system/iot-simulator.service
```

```ini
[Unit]
Description=IoT Device Simulator
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
1. Open Task Scheduler
2. Create Basic Task
3. Trigger: At startup
4. Action: Start a program
5. Program: `python`
6. Arguments: `C:\path\to\simulation_data\mqtt\simulator.py`

## 🌟 Features

- ✅ **Zero code changes** - Existing system untouched
- ✅ **Auto-discovery** - Detects new devices automatically
- ✅ **Realistic data** - Natural trends and variations
- ✅ **Real device feel** - Same workflow as actual devices
- ✅ **Easy testing** - Create device, see data instantly
- ✅ **Configurable** - Adjust intervals and ranges
- ✅ **Lifecycle aware** - Starts/stops with devices

## 📈 Future Enhancements

- Subscribe to test.mosquitto.org topics for real-world data patterns
- Device-type-specific telemetry (water meters, GPS trackers, etc.)
- Alarm condition simulation (trigger high temp, low battery, etc.)
- Replay historical data patterns
- Multi-protocol support (HTTP, CoAP, etc.)
