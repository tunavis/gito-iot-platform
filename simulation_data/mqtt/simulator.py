"""
IoT Device Simulator — publishes synthetic telemetry to the local MQTT broker
through the same wire format a real device of that protocol would use.

SAFETY BOUNDARY (read this first): every query this file runs is scoped to
devices tagged `"simulated"` — see `_DEVICE_QUERY`. That tag is only ever set
by `/api/simulator/create-device` (bridge_ui.py), which creates a brand-new
device for exactly this purpose. This tool will never simulate — and
therefore never overwrite the history of — a device it didn't create itself,
including a real device that happens to share a device type with one you're
testing. This was a real incident, not a hypothetical: fixture mode used to
pick "any existing device of this type" and once corrupted 9 days of a real
meter's history. If you need a device to simulate, create one with the
"Add Simulator Device" panel — never repurpose an existing one.

Two protocols are supported via a small publisher registry keyed by the
device type's own `connectivity.protocol` (see PUBLISHERS below):

  mqtt     Flat JSON on {tenant_id}/devices/{device_id}/telemetry — what
           mqtt_processor.py's native ingest path expects.
  lorawan  A synthetic ChirpStack uplink envelope (raw bytes encoded via the
           device type's own decoder spec) on
           application/simulator/device/{dev_eui}/event/up — the exact topic
           mqtt_processor.py's ChirpStack bridge relays real uplinks onto
           locally, so a simulated LoRaWAN device goes through dedup,
           rate-limiting, NS-vs-declarative decode selection, raw_uplinks
           capture, and alarm evaluation identically to a real one.

Adding a publisher for another protocol (http, modbus, ...) means writing one
more class and registering it — nothing else here changes.

Synthetic values are generated from each device type's own `data_model`
(type/unit/min_value/max_value, plus an optional per-field `simulation` hint
— see SimulationHint in web/.../device-types/_types.ts), not a hardcoded
per-category table. A simulated device with no device type (or an empty
data_model) falls back to the legacy category profile below.

Usage — normally you won't call this directly; the Bridge UI's "Add Simulator
Device" panel does both device creation and simulation for you:
  python simulator.py                          # continuously simulate every
                                                # device tagged 'simulated'
  python simulator.py --device-id <uuid>       # simulate one (must be tagged)
  python simulator.py --interval 10            # publish every 10s
  python simulator.py --fixture <device-type-id> [--count 5]
                                                # publish N uplinks immediately
                                                # for the (tagged) simulator
                                                # device of this type, then
                                                # exit — the repeatable "does
                                                # this decoder actually work"
                                                # check for a newly-authored
                                                # vendor preset. Errors if no
                                                # simulator device exists yet
                                                # for this type — create one
                                                # first, it will never fall
                                                # back to a real device.
"""

import asyncio
import base64
import json
import random
import time
import uuid
import argparse
import logging
from typing import Any, Dict, List, Optional, Tuple

import paho.mqtt.client as mqtt
import psycopg2
from psycopg2.extras import RealDictCursor
import yaml

from payload_codec import encode

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("simulator")


# -- Legacy telemetry profiles, used only for devices with no device type / --
# -- no data_model (kept so pre-existing simulated devices don't go silent) --
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

# Generic fallback range for a data_model field with no min_value/max_value
# and no simulation hint — only meaningful for the numeric types.
_GENERIC_RANGE = {"float": (0.0, 100.0), "integer": (0.0, 100.0)}


class DeviceState:
    """Running state for one simulated device — generates the next synthetic
    payload from its device type's data_model (or the legacy category
    profile, if it has no device type)."""

    def __init__(self, row: dict):
        self.device_id: str = str(row["id"])
        self.tenant_id: str = str(row["tenant_id"])
        self.name: str = row["name"]
        self.dev_eui: Optional[str] = row.get("dev_eui")
        self.category: str = row.get("category") or "default"
        self.data_model: List[dict] = [
            f for f in (row.get("data_model") or [])
            if isinstance(f, dict) and f.get("name")
        ]
        self.decoder: Optional[dict] = row.get("decoder")
        connectivity = row.get("connectivity") or {}
        self.protocol: str = (connectivity.get("protocol") or "mqtt").lower()

        self._field_state: Dict[str, float] = {}
        self._legacy_profile: Optional[dict] = None
        self._legacy_values: Dict[str, float] = {}

        if self.data_model:
            self._init_field_state()
        else:
            self._legacy_profile = PROFILES.get(self.category, PROFILES["default"])
            for metric, cfg in self._legacy_profile.items():
                if cfg.get("increment"):
                    self._legacy_values[metric] = random.uniform(0, cfg["max"] * 0.3)
                else:
                    mid = (cfg["min"] + cfg["max"]) / 2
                    spread = (cfg["max"] - cfg["min"]) * 0.15
                    self._legacy_values[metric] = random.uniform(mid - spread, mid + spread)

    @staticmethod
    def _effective_range(f: dict) -> Tuple[Optional[float], Optional[float]]:
        sim = f.get("simulation") or {}
        lo, hi = sim.get("min"), sim.get("max")
        if lo is None:
            lo = f.get("min_value")
        if hi is None:
            hi = f.get("max_value")
        if lo is not None and hi is not None:
            return float(lo), float(hi)
        return _GENERIC_RANGE.get(f.get("type", "float"), (None, None))

    def _init_field_state(self) -> None:
        for f in self.data_model:
            if f.get("type") == "boolean":
                continue  # no persistent numeric state needed for alarm bits
            lo, hi = self._effective_range(f)
            if lo is None:
                continue  # non-numeric / no meaningful range -> not synthesized
            sim = f.get("simulation") or {}
            mode = sim.get("mode", "drift")
            self._field_state[f["name"]] = hi if mode == "drain" else random.uniform(lo, hi)

    def tick(self) -> Dict[str, Any]:
        """Advance every field by one interval, return the payload dict."""
        if self._legacy_profile is not None:
            return self._tick_legacy_profile()

        payload: Dict[str, Any] = {}
        for f in self.data_model:
            name = f["name"]
            ftype = f.get("type", "float")

            if ftype == "boolean":
                payload[name] = random.random() < 0.03  # rare-true alarm bit
                continue

            if name not in self._field_state:
                continue

            sim = f.get("simulation") or {}
            mode = sim.get("mode", "drift")
            lo, hi = self._effective_range(f)
            v = self._field_state[name]
            span = max(hi - lo, 1e-9)

            if mode == "increment":
                v += random.uniform(0.001, 0.01) * span
            elif mode == "drain":
                v = max(v - random.uniform(0.0005, 0.004) * span, lo)
            else:  # drift
                v = max(lo, min(hi, v + random.uniform(-0.03, 0.03) * span))

            self._field_state[name] = v
            payload[name] = round(v, 3) if ftype == "float" else int(round(v))

        return payload

    def _tick_legacy_profile(self) -> Dict[str, float]:
        payload: Dict[str, float] = {}
        for metric, cfg in self._legacy_profile.items():
            v = self._legacy_values[metric]
            if cfg.get("increment"):
                v += random.uniform(0.01, 0.5)
            elif cfg.get("drain"):
                v -= random.uniform(0, cfg["drain"] * 2)
                v += random.uniform(-cfg.get("drift", 0.1), cfg.get("drift", 0.1)) * 0.1
            else:
                drift = cfg.get("drift", 0.3)
                v += random.uniform(-drift, drift)
            v = max(cfg["min"], min(cfg["max"], v))
            self._legacy_values[metric] = v
            payload[metric] = round(v, 2)
        return payload


# ── Protocol publishers ───────────────────────────────────────────────────────
# One entry per wire protocol; adding a new protocol means adding one class and
# one registry line below. See module docstring.

class ProtocolPublisher:
    def publish(self, mqtt_client: mqtt.Client, state: DeviceState) -> Dict[str, Any]:
        """Publish one synthetic uplink for `state`. Returns the values that
        were sent (for logging/UI), or {} if this device couldn't be
        published (missing prerequisite, e.g. no decoder)."""
        raise NotImplementedError


class MqttNativePublisher(ProtocolPublisher):
    """Native platform format: flat JSON on {tenant}/devices/{id}/telemetry —
    what a real MQTT/HTTP-protocol device (and mqtt_processor.py's native
    ingest path) already speaks."""

    def publish(self, mqtt_client: mqtt.Client, state: DeviceState) -> Dict[str, Any]:
        values = state.tick()
        topic = f"{state.tenant_id}/devices/{state.device_id}/telemetry"
        mqtt_client.publish(topic, json.dumps(values))
        return values


class LoRaWANPublisher(ProtocolPublisher):
    """Synthetic ChirpStack uplink: encodes values via the device type's own
    decoder spec and publishes the raw-bytes envelope to the same
    locally-relayed topic mqtt_processor.py's ChirpStack bridge uses — see
    module docstring. Never touches the real remote ChirpStack broker; only
    ever reads config.yaml's mqtt.local section (enforced by the caller,
    which is the only MQTT client this publisher is given)."""

    def publish(self, mqtt_client: mqtt.Client, state: DeviceState) -> Dict[str, Any]:
        if not state.decoder:
            logger.warning("  %s: protocol=lorawan but device type has no decoder — skipped", state.name)
            return {}
        if not state.dev_eui:
            logger.warning("  %s: protocol=lorawan but device has no dev_eui — skipped", state.name)
            return {}

        values = state.tick()
        try:
            raw = encode(state.decoder, values)
        except ValueError as e:
            logger.warning("  %s: failed to encode synthetic payload (%s) — skipped", state.name, e)
            return {}

        f_port = state.decoder.get("f_port", 1)
        if isinstance(f_port, list):
            f_port = f_port[0] if f_port else 1

        envelope = {
            "deduplicationId": str(uuid.uuid4()),
            "deviceInfo": {"devEui": state.dev_eui, "applicationId": "simulator"},
            "fPort": f_port,
            "data": base64.b64encode(raw).decode(),
            # No 'object' key: an absent NS decode is what makes the processor
            # fall through to the device type's own declarative decoder,
            # matching a real device whose network server has no codec for it.
            "rxInfo": [{
                "rssi": random.randint(-110, -60),
                "snr": round(random.uniform(2.0, 12.0), 1),
                "gatewayId": "simulator-gateway",
            }],
            "txInfo": {"frequency": 868100000},
        }
        topic = f"application/simulator/device/{state.dev_eui}/event/up"
        mqtt_client.publish(topic, json.dumps(envelope))
        return values


PUBLISHERS: Dict[str, ProtocolPublisher] = {
    "mqtt": MqttNativePublisher(),
    "lorawan": LoRaWANPublisher(),
}


class Simulator:
    def __init__(self, config_path: str = "config.yaml"):
        with open(config_path, "r") as f:
            self.config = yaml.safe_load(f)
        self.mqtt_client: Optional[mqtt.Client] = None
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
        # Only ever the local broker — see LoRaWANPublisher's docstring on why
        # that matters for the lorawan path specifically.
        cfg = self.config["mqtt"]["local"]
        cid = "sim_%d" % random.randint(1000, 9999)
        self.mqtt_client = mqtt.Client(client_id=cid)
        self.mqtt_client.on_connect = lambda *a: logger.info("Connected to MQTT broker")
        self.mqtt_client.connect(cfg["host"], cfg["port"], 60)
        self.mqtt_client.loop_start()

    # SAFETY: the `tags @> '["simulated"]'` filter is not optional. Simulated
    # traffic is otherwise indistinguishable from real traffic once decoded
    # (that's the whole point — see the LoRaWAN publisher's docstring) — which
    # cuts both ways: without this filter, this query would just as happily
    # match a real, currently-reporting device and overwrite its history with
    # synthetic data. This tag is only ever set by /api/simulator/create-device
    # (bridge_ui.py), which creates a brand-new device for exactly this
    # purpose — never applied to, or removable from, an existing device via
    # this tool. Do not widen this filter.
    _DEVICE_QUERY = """
        SELECT d.id, d.tenant_id, d.name, d.dev_eui,
               COALESCE(dt.category, 'sensor') AS category,
               dt.data_model, dt.decoder, dt.connectivity
        FROM   devices d
        LEFT JOIN device_types dt ON dt.id = d.device_type_id
        WHERE  d.status != 'error'
          AND  d.tags @> '["simulated"]'::jsonb
    """

    def fetch_devices(self, device_id=None):
        with self.db_conn.cursor(cursor_factory=RealDictCursor) as cur:
            sql = self._DEVICE_QUERY
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
                state = DeviceState(row)
                if state.protocol not in PUBLISHERS:
                    logger.warning(
                        "  Skipping %s: no simulator publisher registered for protocol '%s'",
                        row["name"], state.protocol,
                    )
                    continue
                self.states[did] = state
                logger.info("  Simulating: %s  (%s / %s)", row["name"], row.get("category", "default"), state.protocol)
        for did in active_ids - current_ids:
            logger.info("  Stopped: %s", self.states[did].name)
            del self.states[did]

    def publish(self, state: DeviceState):
        publisher = PUBLISHERS.get(state.protocol)
        if publisher is None:
            return
        values = publisher.publish(self.mqtt_client, state)
        if not values:
            return
        metrics = "  ".join("%s=%s" % (k, v) for k, v in values.items())
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

    # ── Fixture-replay mode ────────────────────────────────────────────────
    # Publish N synthetic uplinks for one device immediately, independent of
    # the poll-interval/device-discovery loop above — the repeatable
    # replacement for a one-off hand-written decoder-proof script.

    def run_fixture(self, device_type_id: str, count: int = 5, delay: float = 1.0,
                     device_id: str | None = None):
        """Publish for one simulator device of `device_type_id`. If
        `device_id` is given, that specific (tagged) device is used; multiple
        simulator devices can otherwise exist for the same type — omitting it
        just picks one of them, which is fine when there's only one."""
        logger.info("Fixture mode: device_type_id=%s, device_id=%s, count=%d",
                     device_type_id, device_id or "(any simulator device of this type)", count)
        self.connect_db()
        self.connect_mqtt()
        try:
            with self.db_conn.cursor(cursor_factory=RealDictCursor) as cur:
                sql, params = self._DEVICE_QUERY + " AND dt.id = %s", [device_type_id]
                if device_id:
                    sql += " AND d.id = %s"
                    params.append(device_id)
                cur.execute(sql + " LIMIT 1", params)
                row = cur.fetchone()
            if not row:
                logger.error(
                    "No simulator device exists for device type %s yet (or "
                    "the given device_id isn't tagged 'simulated'). Fixture "
                    "mode only ever publishes as a device created specifically "
                    "for simulation — it will never pick a real device, even "
                    "if one of this type exists. Create one first: POST "
                    "/api/simulator/create-device (or the 'Add Simulator "
                    "Device' panel in the Bridge UI).",
                    device_type_id,
                )
                return

            state = DeviceState(dict(row))
            publisher = PUBLISHERS.get(state.protocol)
            if publisher is None:
                logger.error("No publisher registered for protocol '%s'", state.protocol)
                return

            logger.info("Publishing as: %s  (%s / %s)", state.name, row.get("category"), state.protocol)
            for i in range(count):
                values = publisher.publish(self.mqtt_client, state)
                metrics = "  ".join("%s=%s" % (k, v) for k, v in values.items()) if values else "(nothing published)"
                logger.info("  [%d/%d]  %s", i + 1, count, metrics)
                if i < count - 1:
                    time.sleep(delay)
            logger.info(
                "Done. Check `telemetry`/`raw_uplinks` for device %s to confirm the decoder produced the expected fields.",
                state.device_id,
            )
        finally:
            if self.mqtt_client:
                self.mqtt_client.loop_stop()
                self.mqtt_client.disconnect()
            if self.db_conn:
                self.db_conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="IoT Device Simulator")
    parser.add_argument("--device-id", help="Target one specific device (UUID) — with --fixture, "
                                              "picks which simulator device to publish as; without it, "
                                              "simulates only that one device instead of all of them")
    parser.add_argument("--interval", type=int, default=30, help="Seconds between publishes (default 30)")
    parser.add_argument("--config", default="config.yaml", help="Config file path")
    parser.add_argument("--fixture", metavar="DEVICE_TYPE_ID",
                         help="Publish N synthetic uplinks for one device type immediately, then exit "
                              "(proves a decoder without waiting on real hardware)")
    parser.add_argument("--count", type=int, default=5, help="Number of uplinks in --fixture mode (default 5)")
    args = parser.parse_args()
    sim = Simulator(args.config)
    if args.fixture:
        sim.run_fixture(args.fixture, count=args.count, device_id=args.device_id)
    else:
        asyncio.run(sim.run(interval=args.interval, device_id=args.device_id))
