"""
Seed realistic IoT device data - Industry standard device types and telemetry.
Based on Cumulocity, AWS IoT Core, and ThingsBoard patterns.
"""

import asyncio
import asyncpg
import random
from datetime import datetime, timedelta
from uuid import uuid4, UUID
import json

# Database connection
DATABASE_URL = "postgresql://gito:dev-password@localhost:5432/gito"

# Tenant ID (default tenant)
TENANT_ID = UUID("00000000-0000-0000-0000-000000000001")

# Industry-standard device types
DEVICE_TYPES = [
    {
        "name": "Environmental Sensor",
        "identifier": "environmental_sensor",
        "description": "Multi-sensor environmental monitoring device",
        "manufacturer": "Bosch",
        "model": "BME680",
        "category": "sensor",
        "capabilities": ["temperature", "humidity", "pressure", "air_quality"],
        "telemetry_interval": 300,  # 5 minutes
    },
    {
        "name": "Smart Energy Meter",
        "identifier": "smart_meter",
        "description": "Three-phase smart electricity meter",
        "manufacturer": "Landis+Gyr",
        "model": "E650",
        "category": "meter",
        "capabilities": ["voltage", "current", "power", "energy"],
        "telemetry_interval": 900,  # 15 minutes
    },
    {
        "name": "GPS Asset Tracker",
        "identifier": "gps_tracker",
        "description": "Real-time GPS tracking device",
        "manufacturer": "Quectel",
        "model": "GL320MG",
        "category": "tracker",
        "capabilities": ["latitude", "longitude", "speed", "battery"],
        "telemetry_interval": 60,  # 1 minute
    },
    {
        "name": "Industrial Gateway",
        "identifier": "industrial_gateway",
        "description": "Modbus/OPC-UA industrial gateway",
        "manufacturer": "Advantech",
        "model": "WISE-4012",
        "category": "gateway",
        "capabilities": ["cpu_usage", "memory_usage", "uptime", "connection_count"],
        "telemetry_interval": 120,  # 2 minutes
    },
    {
        "name": "Water Flow Sensor",
        "identifier": "water_flow_sensor",
        "description": "Ultrasonic water flow measurement",
        "manufacturer": "Siemens",
        "model": "SITRANS FM",
        "category": "sensor",
        "capabilities": ["flow_rate", "total_volume", "temperature", "pressure"],
        "telemetry_interval": 300,  # 5 minutes
    },
    {
        "name": "Smart Thermostat",
        "identifier": "smart_thermostat",
        "description": "IoT-enabled HVAC thermostat",
        "manufacturer": "Nest",
        "model": "Learning Thermostat",
        "category": "actuator",
        "capabilities": ["temperature", "humidity", "target_temperature", "hvac_state"],
        "telemetry_interval": 600,  # 10 minutes
    },
]

# Real-world locations for devices
LOCATIONS = [
    {"name": "New York HQ", "lat": 40.7128, "lon": -74.0060, "city": "New York", "country": "USA"},
    {"name": "London Office", "lat": 51.5074, "lon": -0.1278, "city": "London", "country": "UK"},
    {"name": "Tokyo Plant", "lat": 35.6762, "lon": 139.6503, "city": "Tokyo", "country": "Japan"},
    {"name": "Berlin Warehouse", "lat": 52.5200, "lon": 13.4050, "city": "Berlin", "country": "Germany"},
    {"name": "Sydney Distribution", "lat": -33.8688, "lon": 151.2093, "city": "Sydney", "country": "Australia"},
    {"name": "Singapore Hub", "lat": 1.3521, "lon": 103.8198, "city": "Singapore", "country": "Singapore"},
    {"name": "Toronto Factory", "lat": 43.6532, "lon": -79.3832, "city": "Toronto", "country": "Canada"},
    {"name": "Mumbai Center", "lat": 19.0760, "lon": 72.8777, "city": "Mumbai", "country": "India"},
    {"name": "São Paulo Site", "lat": -23.5505, "lon": -46.6333, "city": "São Paulo", "country": "Brazil"},
    {"name": "Dubai Facility", "lat": 25.2048, "lon": 55.2708, "city": "Dubai", "country": "UAE"},
]


async def clear_existing_data(conn):
    """Remove all demo/test data."""
    print("[*] Clearing existing data...")

    # Delete in order to respect foreign keys
    await conn.execute("DELETE FROM telemetry_hot WHERE tenant_id = $1", TENANT_ID)
    await conn.execute("DELETE FROM alarms WHERE tenant_id = $1", TENANT_ID)
    await conn.execute("DELETE FROM notification_rules WHERE tenant_id = $1", TENANT_ID)
    await conn.execute("DELETE FROM alert_rules WHERE tenant_id = $1", TENANT_ID)
    await conn.execute("DELETE FROM devices WHERE tenant_id = $1", TENANT_ID)
    await conn.execute("DELETE FROM device_types WHERE tenant_id = $1", TENANT_ID)

    print("[+] Existing data cleared")


async def create_device_types(conn):
    """Create industry-standard device types."""
    print("\n[LIST] Creating device types...")

    device_type_ids = {}

    # Icon mapping based on device category
    icon_map = {
        "sensor": "thermometer",
        "meter": "zap",
        "tracker": "map-pin",
        "gateway": "server",
        "actuator": "toggle-left",
    }

    # Color mapping based on device category
    color_map = {
        "sensor": "#10b981",
        "meter": "#f59e0b",
        "tracker": "#3b82f6",
        "gateway": "#8b5cf6",
        "actuator": "#ec4899",
    }

    for dt in DEVICE_TYPES:
        device_type_id = uuid4()

        # Create comprehensive metadata
        metadata = {
            "identifier": dt["identifier"],
            "telemetry_interval_seconds": dt["telemetry_interval"],
            "communication_protocol": "MQTT",
            "power_source": "Battery" if dt["category"] in ["sensor", "tracker"] else "Mains",
            "expected_lifetime_years": 5,
        }

        # Create data model (telemetry schema)
        data_model = []
        for capability in dt["capabilities"]:
            field = {"name": capability, "type": "number"}
            if capability == "temperature":
                field.update({"unit": "°C", "min": -40, "max": 125})
            elif capability == "humidity":
                field.update({"unit": "%", "min": 0, "max": 100})
            elif capability == "pressure":
                field.update({"unit": "hPa", "min": 300, "max": 1100})
            elif capability == "battery":
                field.update({"unit": "%", "min": 0, "max": 100})
            elif capability == "voltage":
                field.update({"unit": "V", "min": 0, "max": 500})
            elif capability == "power":
                field.update({"unit": "W", "min": 0, "max": 10000})
            elif capability == "current":
                field.update({"unit": "A", "min": 0, "max": 100})
            elif capability == "energy":
                field.update({"unit": "kWh", "min": 0, "max": 100000})
            elif capability == "latitude":
                field.update({"unit": "degrees", "min": -90, "max": 90})
            elif capability == "longitude":
                field.update({"unit": "degrees", "min": -180, "max": 180})
            elif capability == "speed":
                field.update({"unit": "km/h", "min": 0, "max": 200})
            data_model.append(field)

        # Capabilities array
        capabilities = dt["capabilities"]

        await conn.execute("""
            INSERT INTO device_types
            (id, tenant_id, name, description, manufacturer, model, category, icon, color,
             data_model, capabilities, metadata, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
        """, device_type_id, TENANT_ID, dt["name"], dt["description"],
            dt["manufacturer"], dt["model"], dt["category"],
            icon_map.get(dt["category"], "cpu"), color_map.get(dt["category"], "#6366f1"),
            json.dumps(data_model), json.dumps(capabilities), json.dumps(metadata))

        device_type_ids[dt["identifier"]] = device_type_id
        print(f"  [+] {dt['name']} ({dt['manufacturer']} {dt['model']})")

    return device_type_ids


async def create_devices(conn, device_type_ids):
    """Create realistic devices across locations."""
    print("\n[DEV] Creating devices...")

    devices = []
    device_counter = 1

    for i, loc in enumerate(LOCATIONS):
        # Each location gets 2-3 devices of different types
        device_types_for_location = random.sample(list(device_type_ids.keys()), k=random.randint(2, 3))

        for dt_identifier in device_types_for_location:
            device_id = uuid4()
            device_type_id = device_type_ids[dt_identifier]

            # Generate realistic device name
            dt_info = next(dt for dt in DEVICE_TYPES if dt["identifier"] == dt_identifier)
            device_name = f"{loc['city']}-{dt_info['identifier'].replace('_', '-').upper()}-{device_counter:03d}"

            # Realistic status distribution: 85% online, 10% offline, 5% idle
            status = random.choices(['online', 'offline', 'idle'], weights=[85, 10, 5])[0]

            # Realistic battery levels
            battery_level = random.uniform(60, 100) if status == 'online' else random.uniform(10, 60)

            # Signal strength
            signal_strength = random.randint(-90, -50) if status == 'online' else random.randint(-120, -90)

            # Last seen
            if status == 'online':
                last_seen = datetime.utcnow() - timedelta(minutes=random.randint(1, 30))
            elif status == 'idle':
                last_seen = datetime.utcnow() - timedelta(hours=random.randint(1, 12))
            else:
                last_seen = datetime.utcnow() - timedelta(days=random.randint(1, 7))

            # Attributes with location
            attributes = {
                "latitude": loc["lat"] + random.uniform(-0.05, 0.05),  # Slight randomization
                "longitude": loc["lon"] + random.uniform(-0.05, 0.05),
                "location_name": loc["name"],
                "city": loc["city"],
                "country": loc["country"],
                "firmware_version": f"v{random.randint(1, 3)}.{random.randint(0, 9)}.{random.randint(0, 20)}",
                "serial_number": f"SN{random.randint(100000, 999999)}",
                "installation_date": (datetime.utcnow() - timedelta(days=random.randint(30, 730))).isoformat(),
            }

            # Generate 16-character DevEUI (standard LoRaWAN format)
            dev_eui = f"{random.randint(0, 0xFFFFFFFFFFFFFFFF):016x}".upper()

            await conn.execute("""
                INSERT INTO devices
                (id, tenant_id, name, device_type, dev_eui, status, last_seen,
                 battery_level, signal_strength, attributes, device_type_id, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
            """, device_id, TENANT_ID, device_name, dt_identifier, dev_eui,
                status, last_seen, battery_level, signal_strength,
                json.dumps(attributes), device_type_id)

            devices.append({
                "id": device_id,
                "name": device_name,
                "type": dt_identifier,
                "status": status,
                "location": loc,
            })

            print(f"  [+] {device_name} ({loc['city']}) - {status}")
            device_counter += 1

    return devices


async def generate_telemetry(conn, devices):
    """Generate realistic telemetry data for the last 7 days."""
    print("\n[DATA] Generating telemetry data...")

    now = datetime.utcnow()
    telemetry_count = 0

    for device in devices:
        if device["status"] == "offline":
            continue  # Skip offline devices

        dt_info = next(dt for dt in DEVICE_TYPES if dt["identifier"] == device["type"])
        interval = dt_info["telemetry_interval"]

        # Generate data for last 7 days
        num_points = int((7 * 24 * 3600) / interval)  # 7 days worth of data

        for i in range(num_points):
            timestamp = now - timedelta(seconds=interval * (num_points - i))

            # Generate realistic telemetry based on capabilities
            telemetry = {}
            payload = {}  # Additional data not in standard columns

            for capability in dt_info["capabilities"]:
                if capability == "temperature":
                    # Realistic temperature with daily cycle
                    hour = timestamp.hour
                    base_temp = 20 + 10 * abs(hour - 14) / 14  # Peak at 2 PM
                    telemetry["temperature"] = round(base_temp + random.uniform(-2, 2), 2)

                elif capability == "humidity":
                    telemetry["humidity"] = round(random.uniform(40, 70), 2)

                elif capability == "pressure":
                    telemetry["pressure"] = round(random.uniform(980, 1020), 2)

                elif capability == "battery":
                    # Gradual battery decay
                    days_ago = (now - timestamp).days
                    telemetry["battery"] = round(100 - (days_ago * 0.5) + random.uniform(-5, 0), 2)

                elif capability == "rssi":
                    telemetry["rssi"] = random.randint(-90, -50)

                elif capability == "voltage":
                    payload["voltage"] = round(random.uniform(220, 240), 2)

                elif capability == "current":
                    payload["current"] = round(random.uniform(1, 10), 2)

                elif capability == "power":
                    # Power varies with time of day
                    hour = timestamp.hour
                    if 8 <= hour <= 18:  # Business hours
                        payload["power"] = round(random.uniform(500, 2000), 2)
                    else:
                        payload["power"] = round(random.uniform(100, 500), 2)

                elif capability == "energy":
                    # Cumulative energy consumption
                    payload["energy"] = round(random.uniform(1000, 50000), 2)

                elif capability == "flow_rate":
                    payload["flow_rate"] = round(random.uniform(5, 50), 2)

                elif capability == "total_volume":
                    payload["total_volume"] = round(random.uniform(1000, 100000), 2)

                elif capability == "latitude":
                    payload["latitude"] = device["location"]["lat"] + random.uniform(-0.001, 0.001)

                elif capability == "longitude":
                    payload["longitude"] = device["location"]["lon"] + random.uniform(-0.001, 0.001)

                elif capability == "speed":
                    payload["speed"] = round(random.uniform(0, 120), 2)

                elif capability == "cpu_usage":
                    payload["cpu_usage"] = round(random.uniform(10, 90), 2)

                elif capability == "memory_usage":
                    payload["memory_usage"] = round(random.uniform(20, 80), 2)

                elif capability == "uptime":
                    payload["uptime"] = random.randint(0, 2592000)  # Up to 30 days in seconds

                elif capability == "connection_count":
                    payload["connection_count"] = random.randint(0, 50)

                elif capability == "target_temperature":
                    payload["target_temperature"] = round(random.uniform(18, 24), 1)

                elif capability == "hvac_state":
                    payload["hvac_state"] = random.choice(["heating", "cooling", "off", "idle"])

                elif capability == "air_quality":
                    payload["air_quality"] = round(random.uniform(0, 500), 0)  # AQI scale

            # Insert telemetry
            await conn.execute("""
                INSERT INTO telemetry_hot
                (id, tenant_id, device_id, timestamp, temperature, humidity,
                 battery, rssi, pressure, payload, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
            """, uuid4(), TENANT_ID, device["id"], timestamp,
                telemetry.get("temperature"), telemetry.get("humidity"),
                telemetry.get("battery"), telemetry.get("rssi"),
                telemetry.get("pressure"), json.dumps(payload) if payload else None)

            telemetry_count += 1

        print(f"  [+] {device['name']}: {num_points} data points")

    print(f"\n[OK] Generated {telemetry_count:,} telemetry records")


async def main():
    """Main seeding function."""
    print("=" * 60)
    print("[SEED] Gito IoT Database Seeding - Industry Standard")
    print("=" * 60)

    conn = await asyncpg.connect(DATABASE_URL)

    try:
        # Clear existing data
        await clear_existing_data(conn)

        # Create device types
        device_type_ids = await create_device_types(conn)

        # Create devices
        devices = await create_devices(conn, device_type_ids)

        # Generate telemetry
        await generate_telemetry(conn, devices)

        print("\n" + "=" * 60)
        print("[OK] Database seeding completed successfully!")
        print(f"[PKG] Created {len(DEVICE_TYPES)} device types")
        print(f"[DEV] Created {len(devices)} devices across {len(LOCATIONS)} locations")
        print("[DATA] Generated 7 days of realistic telemetry data")
        print("=" * 60)

    except Exception as e:
        print(f"\n[ERROR] Error: {e}")
        raise
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
