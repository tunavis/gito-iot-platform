"""
IoT Device MQTT Simulator
Publishes realistic telemetry to the local MQTT broker.

The MQTT processor expects:
  Topic:   {tenant_id}/devices/{device_id}/telemetry
  Payload: { "metric_name": numeric_value, ... }

Usage:
  python simulator.py                          # simulate ALL devices in DB
  python simulator.py --device-id <uuid>       # simulate one device
  python simulator.py --interval 10            # publish every 10s
"""

import asyncio
import json
import random
import time
import argparse
import logging
from typing import Dict, List

import paho.mqtt.client as mqtt
import psycopg2
from psycopg2.extras import RealDictCursor
import yaml

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("simulator")


# -- Telemetry profiles per device-type category --
PROFILES: Dict[str, dict] = {
    "sensor": {
        "temperature": {"min": 15.0, "max": 38.0, "drift": 0.4},
        "humidity":    {"min": 20.0, "max": 90.0, "drift": 0.6},
        "battery":     {"min": 0.0,  "max": 100.0, "drain": 0.003},
    },
    "gateway": {
        "cpu_usage":    {"min": 5.0,  "max": 95.0, "drift": 2.0},
        "memory_usage": {"min": 20.0, "max": 85.0, "drift": 1.0},
        "uptime_hours": {"min": 0.0,  "max": 99999, "increment": True},
    },
    "meter": {
        "energy_kwh":  {"min": 0.0, "max": 99999, "increment": True},
        "power_w":     {"min": 50.0, "max": 5000.0, "drift": 20.0},
        "voltage":     {"min": 220.0, "max": 240.0, "drift": 1.0},
    },
    "tracker": {
        "latitude":  {"min": -34.05, "max": -33.85, "drift": 0.001},
        "longitude": {"min": 18.35,  "max": 18.55,  "drift": 0.001},
        "speed_kmh": {"min": 0.0,    "max": 120.0,  "drift": 5.0},
        "battery":   {"min": 0.0,    "max": 100.0,  "drain": 0.005},
    },
    "default": {
        "temperature": {"min": 15.0, "max": 38.0, "drift": 0.4},
        "humidity":    {"min": 20.0, "max": 90.0, "drift": 0.6},
        "battery":     {"min": 0.0,  "max": 100.0, "drain": 0.003},
    },
}


class DeviceState:
    """Running state for one simulated device."""

    def __init__(self, row: dict, profile: dict):
        self.device_id: str = str(row["id"])
        self.tenant_id: str = str(row["tenant_id"])
        self.name: str = row["name"]
        self.profile = profile
        self.values: Dict[str, float] = {}
        for metric, cfg in profile.items():
            if cfg.get("increment"):
                self.values[metric] = random.uniform(0, cfg["max"] * 0.3)
            else:
                mid = (cfg["min"] + cfg["max"]) / 2
                spread = (cfg["max"] - cfg["min"]) * 0.15
                self.values[metric] = random.uniform(mid - spread, mid + spread)

    def tick(self) -> dict:
        """Advance by one interval, return telemetry dict."""
        payload: Dict[str, float] = {}
        for metric, cfg in self.profile.items():
            v = self.values[metric]
            if cfg.get("increment"):
                v += random.uniform(0.01, 0.5)
            elif cfg.get("drain"):
                v -= random.uniform(0, cfg["drain"] * 2)
                v += random.uniform(-cfg.get("drift", 0.1), cfg.get("drift", 0.1)) * 0.1
            else:
                drift = cfg.get("drift", 0.3)
                v += random.uniform(-drift, drift)
            v = max(cfg["min"], min(cfg["max"], v))
            self.values[metric] = v
            payload[metric] = round(v, 2)
        return payload


class Simulator:
    def __init__(self, config_path: str = "config.yaml"):
        with open(config_path, "r") as f:
            self.config = yaml.safe_load(f)
        self.mqtt_client = None
        self.db_conn = None
        self.states: Dict[str, DeviceState] = {}

    def connect_db(self):
        db = self.config["database"]
        self.db_conn = psycopg2.connect(
            host=db["host"], port=db["port"],
            database=db["database"], user=db["user"], password=db["password"],
        )
        logger.info("Connected to database")

    def connect_mqtt(self):
        cfg = self.config["mqtt"]["local"]
        cid = "sim_%d" % random.randint(1000, 9999)
        self.mqtt_client = mqtt.Client(client_id=cid)
        self.mqtt_client.on_connect = lambda *a: logger.info("Connected to MQTT broker")
        self.mqtt_client.connect(cfg["host"], cfg["port"], 60)
        self.mqtt_client.loop_start()

    def fetch_devices(self, device_id=None):
        with self.db_conn.cursor(cursor_factory=RealDictCursor) as cur:
            sql = """
                SELECT d.id, d.tenant_id, d.name,
                       COALESCE(dt.category, 'sensor') AS category
                FROM   devices d
                LEFT JOIN device_types dt ON dt.id = d.device_type_id
                WHERE  d.status != 'error'
            """
            params = []
            if device_id:
                sql += " AND d.id = %s"
                params.append(device_id)
            sql += " ORDER BY d.created_at DESC"
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]

    def sync_devices(self, device_id=None):
        rows = self.fetch_devices(device_id)
        current_ids = {str(r["id"]) for r in rows}
        active_ids = set(self.states.keys())
        for row in rows:
            did = str(row["id"])
            if did not in active_ids:
                cat = row.get("category", "default")
                profile = PROFILES.get(cat, PROFILES["default"])
                self.states[did] = DeviceState(row, profile)
                logger.info("  Simulating: %s  (%s)", row["name"], cat)
        for did in active_ids - current_ids:
            logger.info("  Stopped: %s", self.states[did].name)
            del self.states[did]

    def publish(self, state: DeviceState):
        payload = state.tick()
        topic = "%s/devices/%s/telemetry" % (state.tenant_id, state.device_id)
        self.mqtt_client.publish(topic, json.dumps(payload))
        metrics = "  ".join("%s=%s" % (k, v) for k, v in payload.items())
        logger.info("  %s  %s", state.name.ljust(30), metrics)

    async def run(self, interval=30, device_id=None):
        logger.info("IoT Device Simulator starting ...")
        self.connect_db()
        self.connect_mqtt()
        check_interval = self.config["simulator"].get("device_check_interval", 30)
        last_check = 0
        try:
            while True:
                now = time.time()
                if now - last_check >= check_interval:
                    self.sync_devices(device_id)
                    last_check = now
                if not self.states:
                    logger.warning("No devices to simulate - waiting ...")
                else:
                    for s in self.states.values():
                        self.publish(s)
                await asyncio.sleep(interval)
        except KeyboardInterrupt:
            logger.info("Shutting down ...")
        finally:
            if self.mqtt_client:
                self.mqtt_client.loop_stop()
                self.mqtt_client.disconnect()
            if self.db_conn:
                self.db_conn.close()
            logger.info("Simulator stopped.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="IoT Device MQTT Simulator")
    parser.add_argument("--device-id", help="Simulate a single device (UUID)")
    parser.add_argument("--interval", type=int, default=30, help="Seconds between publishes (default 30)")
    parser.add_argument("--config", default="config.yaml", help="Config file path")
    args = parser.parse_args()
    sim = Simulator(args.config)
    asyncio.run(sim.run(interval=args.interval, device_id=args.device_id))
