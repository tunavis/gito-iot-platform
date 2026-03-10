#!/usr/bin/env python3
"""
End-to-end MQTT telemetry pipeline test.

Tests the full path: MQTT publish → Mosquitto → mqtt_processor → KeyDB → TimescaleDB → API.

Requires live Docker services (mosquitto, processor, api, postgres, keydb).
Connects to the MQTT broker and the REST API, publishes test messages, and
verifies they appear in the database within the configured timeout.

Usage:
    python scripts/test_mqtt_pipeline.py --api-token <jwt>
    python scripts/test_mqtt_pipeline.py --api-url http://localhost/api/v1 \\
        --mqtt-host localhost --mqtt-port 1883 --timeout 15 --api-token <jwt>

    # Or set the token in env:
    GITO_API_TOKEN=<jwt> python scripts/test_mqtt_pipeline.py

Dependencies (install if not present):
    pip install paho-mqtt requests
"""

import argparse
import base64
import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

try:
    import paho.mqtt.client as mqtt
except ImportError:
    print("[ERROR] paho-mqtt not installed. Run: pip install paho-mqtt")
    sys.exit(1)

try:
    import requests
except ImportError:
    print("[ERROR] requests not installed. Run: pip install requests")
    sys.exit(1)


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="MQTT pipeline E2E test")
    p.add_argument("--api-url",   default="http://localhost/api/v1",
                   help="Base API URL (default: http://localhost/api/v1)")
    p.add_argument("--mqtt-host", default="localhost",
                   help="MQTT broker host (default: localhost)")
    p.add_argument("--mqtt-port", type=int, default=1883,
                   help="MQTT broker port (default: 1883)")
    p.add_argument("--mqtt-user", default="",
                   help="MQTT username (default: anonymous)")
    p.add_argument("--mqtt-pass", default="",
                   help="MQTT password (default: anonymous)")
    p.add_argument("--api-token", default=None,
                   help="Bearer JWT. Falls back to GITO_API_TOKEN env var.")
    p.add_argument("--timeout",   type=int, default=15,
                   help="Seconds to poll for telemetry before failing (default: 15)")
    return p.parse_args()


# ─────────────────────────────────────────────────────────────────────────────
# Report
# ─────────────────────────────────────────────────────────────────────────────

class Report:
    def __init__(self):
        self._results: list[tuple[str, bool, str]] = []

    def record(self, name: str, passed: bool, detail: str = ""):
        self._results.append((name, passed, detail))
        badge = "\033[32m[PASS]\033[0m" if passed else "\033[31m[FAIL]\033[0m"
        line = f"  {badge} {name}"
        if detail:
            line += f"  — {detail}"
        print(line)

    def summary(self) -> int:
        total  = len(self._results)
        passed = sum(1 for _, p, _ in self._results if p)
        failed = total - passed
        print()
        print("=" * 62)
        if failed == 0:
            print(f"\033[32m  {passed}/{total} tests passed\033[0m")
        else:
            print(f"\033[31m  {passed}/{total} passed  ({failed} FAILED)\033[0m")
        print("=" * 62)
        return 0 if failed == 0 else 1


# ─────────────────────────────────────────────────────────────────────────────
# Test runner
# ─────────────────────────────────────────────────────────────────────────────

class PipelineTest:
    def __init__(self, args: argparse.Namespace):
        self.api_url    = args.api_url.rstrip("/")
        self.mqtt_host  = args.mqtt_host
        self.mqtt_port  = args.mqtt_port
        self.mqtt_user  = args.mqtt_user
        self.mqtt_pass  = args.mqtt_pass
        self.timeout    = args.timeout
        self.token      = args.api_token or os.environ.get("GITO_API_TOKEN")
        self.headers    = {"Authorization": f"Bearer {self.token}"}
        self.tenant_id: Optional[str] = None
        self.device_id: Optional[str] = None
        self.report     = Report()
        self._client: Optional[mqtt.Client] = None

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _decode_tenant(self) -> Optional[str]:
        if not self.token:
            return None
        try:
            part = self.token.split(".")[1]
            part += "=" * (-len(part) % 4)
            payload = json.loads(base64.b64decode(part))
            return payload.get("tenant_id")
        except Exception:
            return None

    def _get(self, path: str, **kwargs) -> requests.Response:
        return requests.get(f"{self.api_url}{path}", headers=self.headers,
                            timeout=10, **kwargs)

    def _mqtt_connect(self) -> mqtt.Client:
        cid = f"e2e-{uuid.uuid4().hex[:8]}"
        client = mqtt.Client(client_id=cid)
        if self.mqtt_user:
            client.username_pw_set(self.mqtt_user, self.mqtt_pass)
        client.connect(self.mqtt_host, self.mqtt_port, keepalive=30)
        client.loop_start()
        return client

    def _publish(self, topic: str, payload: dict):
        self._client.publish(topic, json.dumps(payload), qos=1)

    def _poll_for_value(self, device_id: str, metric: str,
                        expected: float, deadline: float) -> bool:
        """Poll the telemetry API until the expected value appears or time runs out."""
        path = (f"/tenants/{self.tenant_id}/devices/{device_id}/telemetry"
                f"?metrics={metric}&hours=0.1")
        while time.monotonic() < deadline:
            try:
                resp = self._get(path)
                if resp.status_code == 200:
                    body = resp.json()
                    rows = body if isinstance(body, list) else body.get("data", [])
                    for row in rows:
                        val = row.get("metric_value") or row.get("value")
                        if val is not None:
                            try:
                                if abs(float(val) - expected) < 0.001:
                                    return True
                            except (TypeError, ValueError):
                                pass
            except Exception:
                pass
            time.sleep(1)
        return False

    # ── Tests ─────────────────────────────────────────────────────────────────

    def t01_api_reachable(self):
        try:
            # /health may or may not exist; any non-5xx means the API is up
            resp = requests.get(f"{self.api_url}/health", timeout=5,
                                headers=self.headers)
            ok = resp.status_code < 500
        except requests.exceptions.ConnectionError as exc:
            self.report.record("API reachable", False, str(exc))
            return
        self.report.record("API reachable", ok, f"HTTP {resp.status_code}")

    def t02_fetch_real_device(self):
        try:
            resp = self._get(f"/tenants/{self.tenant_id}/devices?per_page=1")
            resp.raise_for_status()
            body = resp.json()
            devices = body if isinstance(body, list) else body.get("data", [])
            if devices:
                self.device_id = str(devices[0].get("id"))
                self.report.record("Fetched real device", True,
                                   f"id={self.device_id[:8]}...")
            else:
                self.report.record("Fetched real device", False, "No devices in tenant")
        except Exception as exc:
            self.report.record("Fetched real device", False, str(exc))

    def t03_mqtt_broker_reachable(self):
        try:
            self._client = self._mqtt_connect()
            time.sleep(0.5)
            connected = self._client.is_connected()
            self.report.record("MQTT broker reachable", connected,
                               f"{self.mqtt_host}:{self.mqtt_port}")
        except Exception as exc:
            self.report.record("MQTT broker reachable", False, str(exc))

    def t04_telemetry_stored_in_db(self):
        if not self.device_id or not self._client:
            self.report.record("Telemetry stored in DB", False, "prerequisites failed")
            return
        # Use a distinctive value unlikely to already exist
        value = round(20.0 + (time.time() % 10), 3)
        topic = f"{self.tenant_id}/devices/{self.device_id}/telemetry"
        self._publish(topic, {"e2e_test_temp": value})
        deadline = time.monotonic() + self.timeout
        found = self._poll_for_value(self.device_id, "e2e_test_temp", value, deadline)
        self.report.record("Telemetry stored in DB", found,
                           f"value={value}, timeout={self.timeout}s")

    def t05_device_last_seen_updated(self):
        if not self.device_id:
            self.report.record("device.last_seen updated", False, "prerequisites failed")
            return
        try:
            resp = self._get(f"/tenants/{self.tenant_id}/devices/{self.device_id}")
            resp.raise_for_status()
            device = resp.json()
            last_seen_str = device.get("last_seen")
            if not last_seen_str:
                self.report.record("device.last_seen updated", False, "last_seen is null")
                return
            last_seen = datetime.fromisoformat(last_seen_str.replace("Z", "+00:00"))
            age_s = (datetime.now(timezone.utc) - last_seen).total_seconds()
            ok = age_s < (self.timeout * 2 + 5)
            self.report.record("device.last_seen updated", ok, f"age={age_s:.1f}s")
        except Exception as exc:
            self.report.record("device.last_seen updated", False, str(exc))

    def t06_device_status_online(self):
        if not self.device_id:
            self.report.record("device.status=online", False, "prerequisites failed")
            return
        try:
            resp = self._get(f"/tenants/{self.tenant_id}/devices/{self.device_id}")
            resp.raise_for_status()
            status = resp.json().get("status")
            self.report.record("device.status=online", status == "online",
                               f"status={status!r}")
        except Exception as exc:
            self.report.record("device.status=online", False, str(exc))

    def t07_unknown_device_rejected(self):
        """
        Publishing telemetry for a non-existent device_id should be silently
        dropped by the processor (device existence cache). The random UUID must
        not appear as a device in the API.
        """
        if not self._client:
            self.report.record("Unknown device rejected", False, "MQTT not connected")
            return
        fake_id = str(uuid.uuid4())
        topic = f"{self.tenant_id}/devices/{fake_id}/telemetry"
        self._publish(topic, {"probe": 99.9})
        time.sleep(3)  # allow processor time to (not) write it
        try:
            resp = self._get(f"/tenants/{self.tenant_id}/devices/{fake_id}")
            self.report.record("Unknown device rejected",
                               resp.status_code == 404,
                               f"HTTP {resp.status_code} (expected 404)")
        except Exception as exc:
            self.report.record("Unknown device rejected", False, str(exc))

    def t08_duplicate_deduplication(self):
        """
        Identical payload bytes published twice within 5 seconds: only one row
        should appear in the telemetry table (dedup via SHA-256 + Redis NX key).
        """
        if not self.device_id or not self._client:
            self.report.record("Duplicate deduplication", False, "prerequisites failed")
            return

        dedup_val = 77.77
        topic = f"{self.tenant_id}/devices/{self.device_id}/telemetry"
        raw = json.dumps({"e2e_dedup_probe": dedup_val}).encode()

        self._client.publish(topic, raw, qos=1)
        time.sleep(0.1)
        self._client.publish(topic, raw, qos=1)  # identical bytes → same hash

        # Wait for the first message to land
        deadline = time.monotonic() + self.timeout
        found = self._poll_for_value(self.device_id, "e2e_dedup_probe",
                                     dedup_val, deadline)
        if not found:
            self.report.record("Duplicate deduplication", False,
                               "First message not found in DB")
            return

        time.sleep(2)  # allow any duplicate through if dedup is broken

        path = (f"/tenants/{self.tenant_id}/devices/{self.device_id}/telemetry"
                f"?metrics=e2e_dedup_probe&hours=0.1")
        try:
            resp = self._get(path)
            resp.raise_for_status()
            rows = resp.json()
            if isinstance(rows, dict):
                rows = rows.get("data", [])
            matching = [
                r for r in rows
                if abs(float(r.get("metric_value") or r.get("value", 0))
                       - dedup_val) < 0.001
            ]
            self.report.record("Duplicate deduplication",
                               len(matching) == 1,
                               f"rows found={len(matching)} (expected 1)")
        except Exception as exc:
            self.report.record("Duplicate deduplication", False, str(exc))

    # ── Entrypoint ────────────────────────────────────────────────────────────

    def run(self) -> int:
        print()
        print("=" * 62)
        print("  Gito IoT — MQTT Pipeline E2E Test")
        print(f"  API  : {self.api_url}")
        print(f"  MQTT : {self.mqtt_host}:{self.mqtt_port}")
        print("=" * 62)

        if not self.token:
            print("\n[ERROR] No API token. Pass --api-token or set GITO_API_TOKEN.\n")
            return 1

        self.tenant_id = self._decode_tenant()
        if not self.tenant_id:
            print("\n[ERROR] Could not extract tenant_id from JWT.\n")
            return 1

        print(f"  Tenant: {self.tenant_id}")
        print()

        self.t01_api_reachable()
        self.t02_fetch_real_device()
        self.t03_mqtt_broker_reachable()
        self.t04_telemetry_stored_in_db()
        self.t05_device_last_seen_updated()
        self.t06_device_status_online()
        self.t07_unknown_device_rejected()
        self.t08_duplicate_deduplication()

        if self._client:
            self._client.loop_stop()
            self._client.disconnect()

        return self.report.summary()


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    sys.exit(PipelineTest(parse_args()).run())
