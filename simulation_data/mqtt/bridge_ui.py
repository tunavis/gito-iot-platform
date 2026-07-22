"""
Gito MQTT Bridge UI
===================
Subscribes to an external MQTT broker, discovers live devices, lets you
create them in Gito, then re-publishes their telemetry to the LOCAL
Mosquitto broker so mqtt_processor.py handles it exactly like a real device.

Data flow:
  External broker  →  bridge_ui.py  →  Local Mosquitto  →  mqtt_processor.py  →  DB + Redis

Usage:
    pip install -r requirements.txt
    python bridge_ui.py
    Open http://localhost:5555
"""

import base64
import json
import logging
import os
import random
import re
import secrets
import subprocess
import sys
import threading as _real_threading
import time
from datetime import datetime
from pathlib import Path

import requests
import yaml
from flask import Flask, jsonify, render_template, request
from flask_socketio import SocketIO

import paho.mqtt.client as mqtt

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
logger = logging.getLogger("bridge")

# ── App setup ──────────────────────────────────────────────────────────────────
app = Flask(__name__)
app.config["SECRET_KEY"] = "gito-bridge-2024"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# ── Config ─────────────────────────────────────────────────────────────────────
config_path = Path(__file__).parent / "config.yaml"
with open(config_path) as f:
    config = yaml.safe_load(f)

bridge_cfg   = config.get("bridge", {})
local_cfg    = config["mqtt"]["local"]
demo_cfg     = config["mqtt"].get("demo", {"host": "test.mosquitto.org", "port": 1883})

# Environment variable overrides (used in Docker/staging)
if os.environ.get("GITO_API_URL"):
    bridge_cfg["gito_api_url"] = os.environ["GITO_API_URL"]
if os.environ.get("MQTT_LOCAL_HOST"):
    local_cfg["host"] = os.environ["MQTT_LOCAL_HOST"]
if os.environ.get("MQTT_LOCAL_PORT"):
    local_cfg["port"] = int(os.environ["MQTT_LOCAL_PORT"])
if os.environ.get("UI_PORT"):
    bridge_cfg["ui_port"] = int(os.environ["UI_PORT"])

# ── Global state ───────────────────────────────────────────────────────────────
ext_client:   mqtt.Client | None = None   # subscribes to external broker
local_client: mqtt.Client | None = None   # publishes to local Mosquitto
ext_connected   = False
local_connected = False

# topic → {count, last_payload, last_seen, parsed}
discovered: dict[str, dict] = {}

# Throttle Socket.IO emissions: only push UI updates at most every N seconds per topic
_EMIT_THROTTLE_S = 3.0          # max one UI push per topic per 3 seconds
_last_emit: dict[str, float] = {}  # topic → last emit timestamp

# bridge_id → {id, topic, device_id, device_name, tenant_id, active, count, last_value, started_at, status}
bridges: dict[str, dict] = {}

gito_token:     str | None = None
gito_tenant_id: str | None = None
gito_email:     str | None = None
gito_base_url:  str | None = None  # the URL actually used at login — see _gito_base()

sim_proc: subprocess.Popen | None = None

# ── Saved bridges persistence ───────────────────────────────────────────────────
_SAVED_FILE = Path(__file__).parent / "saved_bridges.json"

def _load_saved() -> dict:
    try:
        if _SAVED_FILE.exists():
            return json.loads(_SAVED_FILE.read_text())
    except Exception:
        pass
    return {}

def _save_to_disk(saved: dict):
    try:
        _SAVED_FILE.write_text(json.dumps(saved, indent=2))
    except Exception as e:
        logger.warning("Could not save bridges: %s", e)

# Load saved bridges on startup
saved_bridges: dict = _load_saved()   # key → {topic, device_id, device_name, tenant_id, broker_host, broker_port, created_at}


# ── Payload helpers ────────────────────────────────────────────────────────────
def _parse_payload(raw: bytes) -> tuple[str, dict | None]:
    try:
        text = raw.decode("utf-8")
    except Exception:
        return f"[binary {len(raw)}b]", None
    try:
        return text, json.loads(text)
    except Exception:
        return text, {"_raw": text}


def _sanitize_metrics(obj, prefix: str = "", out: dict | None = None) -> dict:
    """
    Flatten and sanitize a parsed payload for mqtt_processor.

    Rules:
      - Keys: alphanumeric + underscore only (spaces/hyphens → underscore)
      - Values: numbers, strings, booleans and nested dicts/lists all accepted
        (mqtt_processor handles all types — only system keys like 'timestamp'
         are stripped by the processor itself)
    """
    if out is None:
        out = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            clean = re.sub(r"[^a-zA-Z0-9_]", "_", str(k)).strip("_")
            if not clean:
                continue
            new_prefix = f"{prefix}_{clean}" if prefix else clean
            _sanitize_metrics(v, new_prefix, out)
    elif isinstance(obj, bool):
        key = prefix.rstrip("_")
        if key and re.fullmatch(r"[a-zA-Z0-9_]+", key):
            out[key] = obj
    elif isinstance(obj, (int, float)):
        key = prefix.rstrip("_")
        if key and re.fullmatch(r"[a-zA-Z0-9_]+", key):
            out[key] = obj
    elif isinstance(obj, str):
        key = prefix.rstrip("_")
        if key and re.fullmatch(r"[a-zA-Z0-9_]+", key):
            out[key] = obj
    return out


# ── Local Mosquitto publisher ──────────────────────────────────────────────────
def _connect_local_mqtt():
    global local_client, local_connected

    def on_connect(client, userdata, flags, rc):
        global local_connected
        if rc == 0:
            local_connected = True
            logger.info("Connected to local Mosquitto")
            socketio.emit("local_status", {"connected": True, "message": "Connected to local Mosquitto"})
        else:
            local_connected = False
            socketio.emit("local_status", {"connected": False, "message": f"Local Mosquitto refused (rc={rc})"})

    def on_disconnect(client, userdata, rc):
        global local_connected
        local_connected = False
        socketio.emit("local_status", {"connected": False, "message": "Disconnected from local Mosquitto"})

    if local_client:
        try:

            local_client.disconnect()
        except Exception:
            pass

    client = mqtt.Client(client_id=f"gito_bridge_pub_{random.randint(1000, 9999)}")
    client.on_connect = on_connect
    client.on_disconnect = on_disconnect

    username = local_cfg.get("username", "")
    password = local_cfg.get("password", "")
    if username:
        client.username_pw_set(username, password)

    try:
        import socket as _socket
        lhost = local_cfg["host"]
        lport = int(local_cfg["port"])
        resolved = _socket.getaddrinfo(lhost, lport, _socket.AF_INET, _socket.SOCK_STREAM)[0][4][0]
        client.connect(resolved, lport, keepalive=60)
        t = _real_threading.Thread(target=client.loop_forever, daemon=True)
        t.start()
        local_client = client
        logger.info("Connecting to local Mosquitto %s (%s):%s", lhost, resolved, lport)
    except Exception as exc:
        logger.error("Cannot connect to local Mosquitto: %s", exc)
        socketio.emit("local_status", {"connected": False, "message": str(exc)})


def _topic_last_key(topic: str) -> str:
    """Extract the last segment of an MQTT topic and sanitize it as a metric key."""
    part = topic.rstrip("/").split("/")[-1]
    clean = re.sub(r"[^a-zA-Z0-9_]", "_", part).strip("_")
    return clean or "value"


def _coerce_to_dict(parsed, topic: str) -> dict:
    """
    Ensure the payload is a dict of metrics.
    Plain numeric payloads (e.g. a sensor publishing just '22.5') are wrapped using
    the last segment of the topic as the key: {'SensorTemperature': 22.5}.
    """
    if isinstance(parsed, dict):
        return parsed
    if isinstance(parsed, (int, float)) and not isinstance(parsed, bool):
        return {_topic_last_key(topic): parsed}
    return {}


def _publish_to_local(bridge: dict, parsed: dict | None):
    """Re-publish sanitized metrics to local Mosquitto in Gito topic format."""
    if not local_client or not local_connected:
        socketio.emit(
            "bridge_update",
            {"bridge_id": bridge["id"], "status": "error: local Mosquitto not connected"},
        )
        return

    metrics = _sanitize_metrics(_coerce_to_dict(parsed, bridge["topic"]))
    if not metrics:
        return  # nothing numeric to forward

    topic   = f"{bridge['tenant_id']}/devices/{bridge['device_id']}/telemetry"
    payload = json.dumps(metrics)

    result = local_client.publish(topic, payload, qos=0)
    bridge["count"]       = bridge.get("count", 0) + 1
    bridge["last_value"]  = metrics
    bridge["last_forward"] = datetime.utcnow().isoformat()
    bridge["status"]      = "ok" if result.rc == 0 else f"publish error rc={result.rc}"

    socketio.emit(
        "bridge_update",
        {
            "bridge_id":   bridge["id"],
            "count":       bridge["count"],
            "last_value":  metrics,
            "last_forward": bridge["last_forward"],
            "status":      bridge["status"],
        },
    )
    logger.debug("→ Mosquitto  %s  %s", topic, payload[:120])


# ── External broker MQTT callbacks ─────────────────────────────────────────────
def _on_ext_connect(client, userdata, flags, rc):
    global ext_connected
    if rc == 0:
        ext_connected = True
        topic_filter = userdata.get("topic_filter", "#")
        client.subscribe(topic_filter, qos=0)
        socketio.emit("broker_status", {"connected": True, "message": f"Connected — listening on '{topic_filter}'"})
    else:
        ext_connected = False
        codes = {1: "bad protocol", 2: "bad client id", 3: "unavailable", 4: "bad credentials", 5: "not authorised"}
        socketio.emit("broker_status", {"connected": False, "message": f"Refused: {codes.get(rc, rc)}"})


def _on_ext_disconnect(client, userdata, rc):
    global ext_connected
    ext_connected = False
    socketio.emit("broker_status", {"connected": False, "message": "Disconnected from external broker"})


def _on_ext_message(client, userdata, msg):
    topic  = msg.topic
    text, parsed = _parse_payload(msg.payload)
    now    = datetime.utcnow().isoformat()
    is_new = topic not in discovered

    if is_new:
        discovered[topic] = {"count": 0, "last_payload": None, "last_seen": None, "parsed": None}

    entry = discovered[topic]
    entry["count"]       += 1
    entry["last_payload"] = text[:2000]
    entry["last_seen"]    = now
    entry["parsed"]       = parsed

    # Throttle UI pushes — always emit new topics, throttle existing ones
    now_ts = time.monotonic()
    if is_new or (now_ts - _last_emit.get(topic, 0)) >= _EMIT_THROTTLE_S:
        _last_emit[topic] = now_ts
        socketio.emit("topic_update", {
            "topic":       topic,
            "payload":     text[:500],
            "parsed":      parsed,
            "count":       entry["count"],
            "last_seen":   now,
            "is_new":      is_new,
            "metrics":     _sanitize_metrics(_coerce_to_dict(parsed, topic)),
        })

    # Forward to local Mosquitto if topic is actively bridged.
    # Use first matching bridge only — prevents duplicates if the same topic
    # is bridged more than once (e.g. after UI restart without stopping bridges).
    published = False
    for bridge in bridges.values():
        if bridge["active"] and bridge["topic"] == topic:
            if not published:
                _publish_to_local(bridge, parsed)
                published = True
            else:
                # Keep stats in sync for any extra bridge entries, but don't re-publish
                bridge["count"] = bridge.get("count", 0) + 1


# ── Flask routes ───────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template(
        "index.html",
        broker_host=demo_cfg.get("host", "test.mosquitto.org"),
        broker_port=demo_cfg.get("port", 1883),
        local_host=local_cfg["host"],
        local_port=local_cfg["port"],
        gito_url_default=bridge_cfg.get("gito_api_url", "http://localhost"),
        gito_email_default=bridge_cfg.get("gito_email", ""),
    )


@app.route("/api/connect", methods=["POST"])
def connect_broker():
    global ext_client
    data         = request.json or {}
    host         = data.get("host", demo_cfg["host"])
    port         = int(data.get("port", demo_cfg["port"]))
    username     = data.get("username", "")
    password     = data.get("password", "")
    topic_filter = data.get("topic_filter", "#") or "#"

    if ext_client:
        try:

            ext_client.disconnect()
        except Exception:
            pass

    client = mqtt.Client(
        client_id=f"gito_bridge_sub_{random.randint(1000, 9999)}",
        userdata={"topic_filter": topic_filter},
    )
    client.on_connect    = _on_ext_connect
    client.on_disconnect = _on_ext_disconnect
    client.on_message    = _on_ext_message
    if username:
        client.username_pw_set(username, password)

    # Run DNS + connect in a background thread so the HTTP request returns immediately.
    # Status is pushed back to the browser via Socket.IO broker_status events.
    def _do_connect():
        global ext_client
        try:
            import socket as _socket
            resolved = _socket.getaddrinfo(host, port, _socket.AF_INET, _socket.SOCK_STREAM)[0][4][0]
            logger.info("Resolved %s → %s", host, resolved)
            client.connect(resolved, port, keepalive=60)
            ext_client = client
            client.loop_forever()   # blocks until disconnect
        except Exception as exc:
            logger.error("External broker connect failed: %s", exc)
            socketio.emit("broker_status", {"connected": False, "message": str(exc)})

    _real_threading.Thread(target=_do_connect, daemon=True).start()
    return jsonify({"ok": True, "message": f"Connecting to {host}:{port}…"})


@app.route("/api/disconnect", methods=["POST"])
def disconnect_broker():
    global ext_client, ext_connected
    if ext_client:
        try:

            ext_client.disconnect()
        except Exception:
            pass
        ext_client = None
    ext_connected = False
    socketio.emit("broker_status", {"connected": False, "message": "Disconnected"})
    return jsonify({"ok": True})


@app.route("/api/topics")
def list_topics():
    return jsonify([
        {
            "topic":        t,
            "count":        d["count"],
            "last_payload": d["last_payload"],
            "last_seen":    d["last_seen"],
            "parsed":       d["parsed"],
            "metrics":      _sanitize_metrics(_coerce_to_dict(d["parsed"], t)),
        }
        for t, d in sorted(discovered.items(), key=lambda x: -x[1]["count"])
    ])


@app.route("/api/status")
def status():
    return jsonify({
        "ext_connected":   ext_connected,
        "local_connected": local_connected,
        "topics":          len(discovered),
        "bridges":         len([b for b in bridges.values() if b["active"]]),
    })


# ── Gito endpoints ─────────────────────────────────────────────────────────────
def _gito_base() -> str:
    # Prefer the URL actually used at login (the form field can override the
    # config default) — every endpoint below must agree with login on which
    # Gito instance it's talking to, or "logged in" and "device-types 404"
    # can both be true at once.
    return (gito_base_url or bridge_cfg.get("gito_api_url", "http://localhost")).rstrip("/")


@app.route("/api/gito/session")
def gito_session():
    """Return current Gito login state — used by browser on page load to restore session."""
    if gito_token and gito_tenant_id:
        return jsonify({"ok": True, "logged_in": True, "tenant_id": gito_tenant_id, "email": gito_email or ""})
    return jsonify({"ok": True, "logged_in": False})


@app.route("/api/gito/login", methods=["POST"])
def gito_login():
    global gito_token, gito_tenant_id, gito_email, gito_base_url
    data  = request.json or {}
    base  = (data.get("gito_url") or _gito_base()).rstrip("/")
    email = data.get("email", "")
    pwd   = data.get("password", "")
    try:
        resp = requests.post(f"{base}/api/v1/auth/login", json={"email": email, "password": pwd}, timeout=10)
        if resp.status_code == 200:
            body  = resp.json()
            # Gito wraps responses: {"data": {"access_token": "..."}}
            inner = body.get("data", body)
            token = inner.get("access_token") or inner.get("token") \
                 or body.get("access_token") or body.get("token")
            if not token:
                return jsonify({"ok": False, "message": f"No token in response — keys: {list(body.keys())}"}), 500
            # JWT uses base64url — swap URL-safe chars then pad to multiple of 4
            part = token.split(".")[1].replace("-", "+").replace("_", "/")
            part += "=" * (4 - len(part) % 4)
            jwt_payload    = json.loads(base64.b64decode(part))
            gito_token     = token
            gito_tenant_id = jwt_payload.get("tenant_id")
            gito_email     = email
            gito_base_url  = base
            return jsonify({"ok": True, "tenant_id": gito_tenant_id, "email": email})
        return jsonify({"ok": False, "message": f"Login failed ({resp.status_code}): {resp.text[:300]}"}), 401
    except Exception as exc:
        return jsonify({"ok": False, "message": str(exc)}), 500


@app.route("/api/gito/device-types")
def get_device_types():
    if not gito_token or not gito_tenant_id:
        return jsonify({"ok": False, "message": "Not logged in"}), 401
    try:
        resp = requests.get(
            f"{_gito_base()}/api/v1/tenants/{gito_tenant_id}/device-types",
            headers={"Authorization": f"Bearer {gito_token}"},
            timeout=10,
        )
        if resp.status_code == 200:
            data  = resp.json()
            items = data.get("data", data) if isinstance(data, dict) else data
            return jsonify({"ok": True, "device_types": items})
        return jsonify({"ok": False, "message": f"API {resp.status_code}"}), 500
    except Exception as exc:
        return jsonify({"ok": False, "message": str(exc)}), 500


@app.route("/api/gito/devices")
def list_gito_devices():
    """List devices already registered in Gito — map a topic to an existing device."""
    if not gito_token or not gito_tenant_id:
        return jsonify({"ok": False, "message": "Not logged in"}), 401
    try:
        resp = requests.get(
            f"{_gito_base()}/api/v1/tenants/{gito_tenant_id}/devices?per_page=100",
            headers={"Authorization": f"Bearer {gito_token}"},
            timeout=10,
        )
        if resp.status_code == 200:
            body  = resp.json()
            items = body.get("data", body) if isinstance(body, dict) else body
            return jsonify({"ok": True, "devices": items})
        return jsonify({"ok": False, "message": f"API {resp.status_code}"}), 500
    except Exception as exc:
        return jsonify({"ok": False, "message": str(exc)}), 500


@app.route("/api/gito/create-device", methods=["POST"])
def create_device():
    if not gito_token or not gito_tenant_id:
        return jsonify({"ok": False, "message": "Not logged in"}), 401
    data    = request.json or {}
    if not data.get("name", "").strip():
        return jsonify({"ok": False, "message": "Device name is required"}), 422
    payload = {
        "name":        data["name"].strip(),
        "status":      "active",
        "description": data.get("description", f"MQTT Bridge — topic: {data.get('topic', '')}"),
    }
    # device_type string — use selected type name, or derive from topic, or fallback
    payload["device_type"] = (
        data.get("device_type_name")
        or data.get("topic", "").split("/")[0][:50]
        or "mqtt_device"
    )
    if data.get("device_type_id"):
        payload["device_type_id"] = data["device_type_id"]
    if data.get("location"):
        payload["location"] = data["location"]
    try:
        resp = requests.post(
            f"{_gito_base()}/api/v1/tenants/{gito_tenant_id}/devices",
            json=payload,
            headers={"Authorization": f"Bearer {gito_token}", "Content-Type": "application/json"},
            timeout=10,
        )
        if resp.status_code in (200, 201):
            body = resp.json()
            device = body.get("data", body)  # unwrap SuccessResponse
            return jsonify({"ok": True, "device": device})
        return jsonify({"ok": False, "message": f"API {resp.status_code}: {resp.text}"}), 500
    except Exception as exc:
        return jsonify({"ok": False, "message": str(exc)}), 500


# ── Simulator devices ──────────────────────────────────────────────────────────
# Dedicated, clearly-tagged devices created *only* for the simulator to
# publish as. This is the safety boundary: simulator.py's queries all require
# tags @> '["simulated"]', so a device created here is the *only* kind the
# simulator will ever touch — see simulator.py's module docstring for why
# that matters (this replaces fixture mode picking a random existing device,
# which once corrupted 9 days of a real meter's history).
SIMULATED_TAG = "simulated"


def _fetch_all_devices(headers: dict) -> list[dict]:
    """The real API caps per_page at 100 — paginate through everything rather
    than assuming the tenant's whole fleet fits on one page. This tenant
    already has 67+ real devices before counting any simulator ones, and the
    fleet only grows."""
    all_devices: list[dict] = []
    page = 1
    while True:
        resp = requests.get(
            f"{_gito_base()}/api/v1/tenants/{gito_tenant_id}/devices?per_page=100&page={page}",
            headers=headers, timeout=10,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"API {resp.status_code}: {resp.text[:200]}")
        body  = resp.json()
        items = body.get("data", body) if isinstance(body, dict) else body
        all_devices.extend(items)
        meta = body.get("meta") if isinstance(body, dict) else None
        total = (meta or {}).get("total", len(all_devices))
        if len(all_devices) >= total or not items:
            break
        page += 1
    return all_devices


@app.route("/api/simulator/devices")
def list_simulator_devices():
    """List devices this tool created for simulation — optionally filtered to
    one device type. Used by the 'Add Simulator Device' panel to show what
    already exists before creating another one."""
    if not gito_token or not gito_tenant_id:
        return jsonify({"ok": False, "message": "Not logged in"}), 401
    device_type_id = request.args.get("device_type_id")
    try:
        items = _fetch_all_devices({"Authorization": f"Bearer {gito_token}"})
        sim_devices = [
            d for d in items
            if SIMULATED_TAG in (d.get("tags") or [])
            and (not device_type_id or d.get("device_type_id") == device_type_id)
        ]
        return jsonify({"ok": True, "devices": sim_devices})
    except Exception as exc:
        return jsonify({"ok": False, "message": str(exc)}), 500


@app.route("/api/simulator/create-device", methods=["POST"])
def create_simulator_device():
    """Create a brand-new device tagged 'simulated', for one device type —
    the only safe way to get a device for the simulator to publish as."""
    if not gito_token or not gito_tenant_id:
        return jsonify({"ok": False, "message": "Not logged in"}), 401
    data = request.json or {}
    device_type_id = data.get("device_type_id")
    if not device_type_id:
        return jsonify({"ok": False, "message": "device_type_id is required"}), 422

    headers = {"Authorization": f"Bearer {gito_token}", "Content-Type": "application/json"}
    try:
        dt_resp = requests.get(
            f"{_gito_base()}/api/v1/tenants/{gito_tenant_id}/device-types/{device_type_id}",
            headers=headers, timeout=10,
        )
        if dt_resp.status_code != 200:
            return jsonify({"ok": False, "message": f"Device type not found ({dt_resp.status_code})"}), 404
        dt_body     = dt_resp.json()
        device_type = dt_body.get("data", dt_body)
    except Exception as exc:
        return jsonify({"ok": False, "message": f"Failed to load device type: {exc}"}), 500

    protocol  = ((device_type.get("connectivity") or {}).get("protocol") or "mqtt").lower()
    type_name = device_type.get("name", "device")
    name = (data.get("name") or "").strip() or f"SIM - {type_name} - {secrets.token_hex(2)}"

    payload = {
        "name": name,
        "device_type": type_name,
        "device_type_id": device_type_id,
        "description": f"Created by the simulator for testing {type_name} — never a real device.",
        "tags": [SIMULATED_TAG],
    }

    attempts = 3 if protocol == "lorawan" else 1
    for attempt in range(attempts):
        if protocol == "lorawan":
            payload["dev_eui"] = secrets.token_hex(8)  # 16 hex chars
        try:
            resp = requests.post(
                f"{_gito_base()}/api/v1/tenants/{gito_tenant_id}/devices",
                json=payload, headers=headers, timeout=10,
            )
        except Exception as exc:
            return jsonify({"ok": False, "message": str(exc)}), 500
        if resp.status_code in (200, 201):
            body = resp.json()
            return jsonify({"ok": True, "device": body.get("data", body)})
        if resp.status_code == 409 and attempt < attempts - 1:
            continue  # dev_eui collision (astronomically unlikely) — try a new one
        return jsonify({"ok": False, "message": f"API {resp.status_code}: {resp.text}"}), 500
    return jsonify({"ok": False, "message": "Could not allocate a unique dev_eui"}), 500


@app.route("/api/simulator/delete-device", methods=["POST"])
def delete_simulator_device():
    """Delete a simulator-created device. Refuses unless the device is
    actually tagged 'simulated' — this tool will not delete a real device,
    even if asked to."""
    if not gito_token or not gito_tenant_id:
        return jsonify({"ok": False, "message": "Not logged in"}), 401
    data      = request.json or {}
    device_id = data.get("device_id")
    if not device_id:
        return jsonify({"ok": False, "message": "device_id is required"}), 422
    headers = {"Authorization": f"Bearer {gito_token}"}
    try:
        get_resp = requests.get(
            f"{_gito_base()}/api/v1/tenants/{gito_tenant_id}/devices/{device_id}",
            headers=headers, timeout=10,
        )
        if get_resp.status_code != 200:
            return jsonify({"ok": False, "message": f"Device not found ({get_resp.status_code})"}), 404
        device = get_resp.json()
        device = device.get("data", device)
        if SIMULATED_TAG not in (device.get("tags") or []):
            return jsonify({"ok": False, "message": "Refusing to delete: this device is not tagged 'simulated'"}), 403
        del_resp = requests.delete(
            f"{_gito_base()}/api/v1/tenants/{gito_tenant_id}/devices/{device_id}",
            headers=headers, timeout=10,
        )
        if del_resp.status_code in (200, 204):
            return jsonify({"ok": True})
        return jsonify({"ok": False, "message": f"API {del_resp.status_code}: {del_resp.text}"}), 500
    except Exception as exc:
        return jsonify({"ok": False, "message": str(exc)}), 500


@app.route("/api/detect-gito-url")
def detect_gito_url():
    """Probe a short list of common local URLs and return whichever answers
    /api/health — so the login form pre-fills correctly without the user
    needing to know internal port numbers (we got this wrong ourselves more
    than once this session: the config default is a guess, not a guarantee)."""
    candidates = [bridge_cfg.get("gito_api_url", "http://localhost")]
    for extra in ("http://localhost:8088", "http://localhost:8001", "http://localhost"):
        if extra not in candidates:
            candidates.append(extra)
    for base in candidates:
        try:
            r = requests.get(f"{base}/api/health", timeout=1.5)
            if r.status_code == 200:
                return jsonify({"ok": True, "url": base})
        except Exception:
            continue
    return jsonify({"ok": False, "url": candidates[0]})


# ── Bridge management ──────────────────────────────────────────────────────────
@app.route("/api/bridge/start", methods=["POST"])
def start_bridge():
    if not gito_token or not gito_tenant_id:
        return jsonify({"ok": False, "message": "Not logged in to Gito"}), 401
    if not local_connected:
        return jsonify({"ok": False, "message": "Local Mosquitto not connected — check config.yaml mqtt.local"}), 503

    data      = request.json or {}
    for field in ("topic", "device_id", "device_name"):
        if not data.get(field):
            return jsonify({"ok": False, "message": f"Missing required field: {field}"}), 422
    bridge_id = f"bridge_{random.randint(10000, 99999)}"
    bridge    = {
        "id":          bridge_id,
        "topic":       data["topic"],
        "device_id":   data["device_id"],
        "device_name": data["device_name"],
        "tenant_id":   gito_tenant_id,
        "active":      True,
        "count":       0,
        "last_value":  None,
        "last_forward": None,
        "status":      "ok",
        "started_at":  datetime.utcnow().isoformat(),
    }
    bridges[bridge_id] = bridge

    # Subscribe to the specific topic on the external broker
    if ext_client and ext_connected:
        ext_client.subscribe(data["topic"], qos=0)

    # Persist to saved_bridges.json
    saved_bridges[data["topic"]] = {
        "topic":       data["topic"],
        "device_id":   data["device_id"],
        "device_name": data["device_name"],
        "tenant_id":   gito_tenant_id,
        "broker_host": data.get("broker_host", demo_cfg["host"]),
        "broker_port": data.get("broker_port", demo_cfg["port"]),
        "created_at":  datetime.utcnow().isoformat(),
    }
    _save_to_disk(saved_bridges)

    logger.info(
        "Bridge started: %s → local/%s/devices/%s/telemetry",
        data["topic"], gito_tenant_id, data["device_id"],
    )
    return jsonify({"ok": True, "bridge": bridge})


@app.route("/api/bridge/stop", methods=["POST"])
def stop_bridge():
    data = request.json or {}
    bid  = data.get("bridge_id")
    if bid in bridges:
        bridges[bid]["active"] = False
        return jsonify({"ok": True})
    return jsonify({"ok": False, "message": "Bridge not found"}), 404


@app.route("/api/bridges")
def list_bridges():
    return jsonify(list(bridges.values()))


# ── Simulator control ───────────────────────────────────────────────────────────

@app.route("/api/simulator/status")
def simulator_status():
    running = sim_proc is not None and sim_proc.poll() is None
    return jsonify({"ok": True, "running": running, "pid": sim_proc.pid if running else None})


@app.route("/api/simulator/start", methods=["POST"])
def start_simulator():
    global sim_proc
    if sim_proc and sim_proc.poll() is None:
        return jsonify({"ok": True, "running": True, "pid": sim_proc.pid})
    data = request.json or {}
    interval = int(data.get("interval", 30))
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "simulator.py")
    sim_proc = subprocess.Popen(
        [sys.executable, script, "--interval", str(interval)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    return jsonify({"ok": True, "running": True, "pid": sim_proc.pid})


@app.route("/api/simulator/stop", methods=["POST"])
def stop_simulator():
    global sim_proc
    if sim_proc and sim_proc.poll() is None:
        sim_proc.terminate()
        try:
            sim_proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            sim_proc.kill()
    sim_proc = None
    return jsonify({"ok": True, "running": False})


@app.route("/api/simulator/fixture", methods=["POST"])
def run_fixture():
    """Publish N synthetic uplinks for one device type immediately (--fixture
    mode) and return the log output — the repeatable "does this decoder
    actually work" check, run from the UI instead of a terminal."""
    data = request.json or {}
    device_type_id = data.get("device_type_id")
    if not device_type_id:
        return jsonify({"ok": False, "message": "device_type_id is required"}), 422
    count = max(1, min(int(data.get("count", 5)), 20))
    device_id = data.get("device_id")  # optional — which simulator device to publish as

    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "simulator.py")
    cmd = [sys.executable, script, "--fixture", device_type_id, "--count", str(count)]
    if device_id:
        cmd += ["--device-id", device_id]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True, text=True, timeout=count * 3 + 15,
        )
    except subprocess.TimeoutExpired:
        return jsonify({"ok": False, "message": "Fixture run timed out"}), 504

    output = (result.stdout or "") + (result.stderr or "")
    return jsonify({"ok": result.returncode == 0, "output": output})


@app.route("/api/bridge/saved")
def list_saved():
    """Return persisted saved bridges with active status overlay."""
    active_topics = {b["topic"] for b in bridges.values() if b["active"]}
    result = []
    for entry in saved_bridges.values():
        result.append({**entry, "active": entry["topic"] in active_topics})
    return jsonify(result)


@app.route("/api/bridge/saved/delete", methods=["POST"])
def delete_saved():
    topic = (request.json or {}).get("topic")
    if topic in saved_bridges:
        del saved_bridges[topic]
        _save_to_disk(saved_bridges)
        return jsonify({"ok": True})
    return jsonify({"ok": False, "message": "Not found"}), 404


@app.route("/api/bridge/resume", methods=["POST"])
def resume_bridge():
    """Re-activate a saved bridge (must be logged in + ext broker connected)."""
    if not gito_token or not gito_tenant_id:
        return jsonify({"ok": False, "message": "Not logged in to Gito"}), 401
    if not local_connected:
        return jsonify({"ok": False, "message": "Local Mosquitto not connected"}), 503
    if not ext_client or not ext_connected:
        return jsonify({"ok": False, "message": "External broker not connected — connect first"}), 503

    topic = (request.json or {}).get("topic")
    saved = saved_bridges.get(topic)
    if not saved:
        return jsonify({"ok": False, "message": "Saved bridge not found"}), 404

    # Don't create duplicate active bridge for same topic
    for b in bridges.values():
        if b["topic"] == topic and b["active"]:
            return jsonify({"ok": True, "bridge": b})

    bridge_id = f"bridge_{random.randint(10000, 99999)}"
    bridge = {
        "id":          bridge_id,
        "topic":       saved["topic"],
        "device_id":   saved["device_id"],
        "device_name": saved["device_name"],
        "tenant_id":   saved["tenant_id"],
        "active":      True,
        "count":       0,
        "last_value":  None,
        "last_forward": None,
        "status":      "ok",
        "started_at":  datetime.utcnow().isoformat(),
    }
    bridges[bridge_id] = bridge
    ext_client.subscribe(saved["topic"], qos=0)
    logger.info("Bridge resumed: %s → local/%s/devices/%s/telemetry",
                saved["topic"], saved["tenant_id"], saved["device_id"])
    return jsonify({"ok": True, "bridge": bridge})


@app.route("/api/local/reconnect", methods=["POST"])
def reconnect_local():
    """Re-attempt connection to local Mosquitto (e.g. after Docker restart)."""
    _connect_local_mqtt()
    return jsonify({"ok": True})


# ── Entry point ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # Always connect to local Mosquitto on startup
    _connect_local_mqtt()

    print("\n" + "=" * 62)
    print("  Gito MQTT Bridge UI")
    print(f"  Local Mosquitto : {local_cfg['host']}:{local_cfg['port']}")
    print("  Open  ->  http://localhost:5555")
    print("=" * 62 + "\n")
    ui_port = bridge_cfg.get("ui_port", 5555)
    socketio.run(app, host="0.0.0.0", port=ui_port, debug=False, allow_unsafe_werkzeug=True)
