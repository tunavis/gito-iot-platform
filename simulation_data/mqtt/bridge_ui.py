import threading as _real_threading

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

    Rules (from TelemetryValidator in mqtt_processor.py):
      - Keys: alphanumeric + underscore only
      - Values: numeric (int/float) only  ← strings are dropped
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
    elif isinstance(obj, (int, float)) and not isinstance(obj, bool):
        key = prefix.rstrip("_")
        if key and re.fullmatch(r"[a-zA-Z0-9_]+", key):
            out[key] = obj
    # Strings and booleans are intentionally dropped — processor rejects them
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


def _publish_to_local(bridge: dict, parsed: dict | None):
    """Re-publish sanitized metrics to local Mosquitto in Gito topic format."""
    if not local_client or not local_connected:
        socketio.emit(
            "bridge_update",
            {"bridge_id": bridge["id"], "status": "error: local Mosquitto not connected"},
        )
        return

    metrics = _sanitize_metrics(parsed or {})
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
            "metrics":     _sanitize_metrics(parsed or {}),
        })

    # Forward to local Mosquitto if topic is actively bridged
    for bridge in bridges.values():
        if bridge["active"] and bridge["topic"] == topic:
            _publish_to_local(bridge, parsed)


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

    try:
        # Pre-resolve hostname → bypass Windows DNS flakiness in background threads
        import socket as _socket
        resolved = _socket.getaddrinfo(host, port, _socket.AF_INET, _socket.SOCK_STREAM)[0][4][0]
        logger.info("Resolved %s → %s", host, resolved)
        client.connect(resolved, port, keepalive=60)  # blocking connect in Flask thread
        t = _real_threading.Thread(target=client.loop_forever, daemon=True)
        t.start()
        ext_client = client
        return jsonify({"ok": True, "message": f"Connecting to {host}:{port}…"})
    except Exception as exc:
        return jsonify({"ok": False, "message": str(exc)}), 500


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
            "metrics":      _sanitize_metrics(d["parsed"] or {}),
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
    return bridge_cfg.get("gito_api_url", "http://localhost").rstrip("/")


@app.route("/api/gito/login", methods=["POST"])
def gito_login():
    global gito_token, gito_tenant_id
    data  = request.json or {}
    base  = data.get("gito_url", _gito_base()).rstrip("/")
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


@app.route("/api/gito/create-device", methods=["POST"])
def create_device():
    if not gito_token or not gito_tenant_id:
        return jsonify({"ok": False, "message": "Not logged in"}), 401
    data    = request.json or {}
    payload = {
        "name":        data["name"],
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


# ── Bridge management ──────────────────────────────────────────────────────────
@app.route("/api/bridge/start", methods=["POST"])
def start_bridge():
    if not gito_token or not gito_tenant_id:
        return jsonify({"ok": False, "message": "Not logged in to Gito"}), 401
    if not local_connected:
        return jsonify({"ok": False, "message": "Local Mosquitto not connected — check config.yaml mqtt.local"}), 503

    data      = request.json or {}
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


# ── Entry point ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # Always connect to local Mosquitto on startup
    _connect_local_mqtt()

    print("\n" + "=" * 62)
    print("  Gito MQTT Bridge UI")
    print(f"  Local Mosquitto : {local_cfg['host']}:{local_cfg['port']}")
    print("  Open  →  http://localhost:5555")
    print("=" * 62 + "\n")
    ui_port = bridge_cfg.get("ui_port", 5555)
    socketio.run(app, host="0.0.0.0", port=ui_port, debug=False, allow_unsafe_werkzeug=True)
