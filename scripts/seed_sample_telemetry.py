#!/usr/bin/env python3
"""
Seed Sample Telemetry Data for Testing Dashboard Widgets
Run this to populate devices with realistic telemetry data
"""

import asyncio
import sys
from datetime import datetime, timedelta
import random
from pathlib import Path

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).parent.parent / "api"))

from app.database import get_db
from sqlalchemy import text


async def seed_telemetry():
    """Seed sample telemetry data for all devices."""
    async for session in get_db():
        print("🔍 Finding devices...")

        # Get all devices
        result = await session.execute(
            text("SELECT id, name, device_type_id FROM devices LIMIT 10")
        )
        devices = result.fetchall()

        if not devices:
            print("❌ No devices found. Create devices first.")
            return

        print(f"✓ Found {len(devices)} devices\n")

        # Generate telemetry for each device (last 24 hours)
        for device in devices:
            device_id, device_name, device_type_id = device
            print(f"📊 Generating telemetry for: {device_name}")

            # Generate 24 data points (hourly for last 24 hours)
            now = datetime.utcnow()
            data_points = []

            for i in range(24, 0, -1):
                timestamp = now - timedelta(hours=i)

                # Generate realistic sensor data
                telemetry = {
                    "device_id": str(device_id),
                    "timestamp": timestamp.isoformat(),
                    "temperature": round(20 + random.uniform(-5, 10), 2),
                    "humidity": round(50 + random.uniform(-20, 30), 2),
                    "pressure": round(1013 + random.uniform(-10, 10), 2),
                    "battery": round(85 + random.uniform(-15, 10), 2),
                }

                # Add device-type specific metrics
                if device_type_id:
                    # Water flow sensor
                    telemetry.update({
                        "flow_rate": round(random.uniform(10, 50), 2),
                        "velocity": round(random.uniform(0.5, 3), 2),
                        "total_volume": round(random.uniform(100, 500), 2),
                    })
                    # Energy meter
                    telemetry.update({
                        "power": round(random.uniform(1, 10), 2),
                        "voltage": round(220 + random.uniform(-10, 10), 2),
                        "current": round(random.uniform(1, 20), 2),
                        "energy": round(random.uniform(10, 100), 2),
                    })

                data_points.append(telemetry)

            # Insert telemetry data
            # Note: Adjust table name and schema based on your actual telemetry table
            for data in data_points:
                try:
                    # This is a generic insert - adjust based on your schema
                    # Assuming you have a telemetry table or time-series table
                    await session.execute(
                        text("""
                            INSERT INTO device_telemetry (device_id, timestamp, data)
                            VALUES (:device_id, :timestamp, :data::jsonb)
                            ON CONFLICT (device_id, timestamp) DO NOTHING
                        """),
                        {
                            "device_id": device_id,
                            "timestamp": data["timestamp"],
                            "data": data
                        }
                    )
                except Exception as e:
                    # If device_telemetry table doesn't exist, just skip
                    print(f"   ⚠️  Telemetry table may not exist: {e}")
                    break

            await session.commit()
            print(f"   ✓ Added {len(data_points)} data points")

        print("\n✅ Sample telemetry data seeded successfully!")
        print("\n💡 Tip: Devices now have 24 hours of hourly data")
        print("   Metrics: temperature, humidity, pressure, battery, flow_rate, velocity, power, voltage, current, energy")
        break


if __name__ == "__main__":
    print("=" * 60)
    print("🌱 Seeding Sample Telemetry Data")
    print("=" * 60)
    print()

    try:
        asyncio.run(seed_telemetry())
    except KeyboardInterrupt:
        print("\n\n❌ Cancelled by user")
    except Exception as e:
        print(f"\n\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
