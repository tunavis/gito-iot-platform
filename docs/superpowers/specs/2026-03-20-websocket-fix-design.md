# WebSocket Fix & localhost Conflict Resolution

**Date:** 2026-03-20
**Status:** Approved
**Scope:** Fix two blocking issues preventing real-time telemetry in device visualization

---

## Problem Summary

Two issues prevent the live WebSocket telemetry from working in local development:

1. **localhost conflict** — Something on Windows is listening on port 80 before Docker's nginx, so the app is only reachable via LAN IP (`192.168.0.9`), not `localhost`.
2. **WebSocket never delivers data** — The WebSocket connection appears to succeed but never forwards telemetry. Two root causes: nginx silently kills idle connections after 60s, and the WebSocket main loop is a tight busy-spin that starves the asyncio event loop.

---

## Fix 1: localhost Port 80 Conflict

### Diagnosis

Run in Windows PowerShell to identify what holds port 80:

```powershell
netstat -ano | findstr ":80 "
# Then look up the PID:
tasklist | findstr "<PID>"
```

### Resolution

**Primary:** If the conflicting service is IIS or another dispensable process — stop and disable it:
- IIS: `iisreset /stop` then disable via `Services` or `Turn Windows features off`
- Other: stop the service and set it to manual start

**Fallback (if the conflicting service is needed):** Change Docker nginx port mapping in `docker-compose.yml`:
```yaml
nginx:
  ports:
    - "8080:80"   # was "80:80"
    - "443:443"
```
App would then be at `localhost:8080`.

---

## Fix 2: nginx proxy_read_timeout

### Problem

The `/api/` nginx location has no `proxy_read_timeout`. nginx default is 60 seconds — any WebSocket connection with no data for 60s is silently terminated. Device visualization pages connecting to a device with infrequent telemetry will see the connection die after 60 seconds.

### Change

**File:** `nginx/nginx.conf`

Add a dedicated, more-specific location block for WebSocket paths **before** the general `/api/` block. This avoids applying a 3600s timeout to REST API calls (where a 60s default is appropriate):

```nginx
# WebSocket connections — long-lived, need extended timeouts
location /api/v1/ws/ {
    proxy_pass http://api_backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

This keeps WebSocket connections alive for up to 1 hour of inactivity without affecting REST endpoint timeouts. The frontend reconnect logic (exponential backoff, max 10 attempts) handles any connection drop.

---

## Fix 3: WebSocket Main Loop Busy-Spin Bug

### Problem

In `api/app/routers/websocket.py`, the main loop (lines 147–182) is a tight busy-spin:

```python
while True:
    # get_message() is non-blocking — returns None immediately if no message
    message = await telemetry_pubsub.get_message(...)   # returns None instantly
    message = await alerts_pubsub.get_message(...)      # returns None instantly
    try:
        client_msg = await websocket.receive_json(mode="text")  # raises immediately, no client msg
        await _handle_websocket_message(websocket, client_msg)
    except Exception:
        pass  # exception silently swallowed, loop repeats immediately
```

`get_message()` returns `None` immediately when there is nothing queued. `receive_json()` raises an exception when no client message has arrived, which is silently caught. The result is a loop that runs as fast as the CPU allows — near 100% CPU usage — and never yields control to the asyncio event loop long enough to actually forward incoming Redis messages to the WebSocket client.

### Fix: Two concurrent asyncio tasks

Replace the single busy-spin loop with two tasks running concurrently via `asyncio.gather()`:

**Task A — Redis → WebSocket:** Polls both pub/sub channels in a loop. When a message arrives, forwards it to the client. When idle (no messages), yields with `asyncio.sleep(0.01)` to avoid busy-spinning. If any send fails (client disconnected), catches the exception and sets `disconnect_event`.

**Task B — WebSocket → handler:** Awaits client messages (ping/pong). Handles `WebSocketDisconnect` by setting `disconnect_event` so Task A also exits.

**Coordination:** Both tasks share an `asyncio.Event` called `disconnect_event`. Either task can set it on disconnect or error. Both tasks check the event on each iteration. `asyncio.gather(return_exceptions=True)` runs both concurrently. Note: after `disconnect_event` is set, Task A will exit on its next loop iteration (up to 10ms latency from `asyncio.sleep(0.01)`) — this is acceptable.

```python
disconnect_event = asyncio.Event()

async def redis_to_ws():
    while not disconnect_event.is_set():
        had_message = False
        msg = await telemetry_pubsub.get_message(ignore_subscribe_messages=True)
        if msg:
            had_message = True
            try:
                await websocket.send_json({"type": "telemetry", "data": json.loads(msg["data"])})
            except Exception:
                disconnect_event.set()
                return
        msg = await alerts_pubsub.get_message(ignore_subscribe_messages=True)
        if msg:
            had_message = True
            try:
                await websocket.send_json({"type": "alert", "data": json.loads(msg["data"])})
            except Exception:
                disconnect_event.set()
                return
        if not had_message:
            await asyncio.sleep(0.01)  # yield to event loop when idle

async def ws_to_handler():
    try:
        while not disconnect_event.is_set():
            client_msg = await websocket.receive_json(mode="text")
            await _handle_websocket_message(websocket, client_msg)
    except WebSocketDisconnect:
        disconnect_event.set()
    except Exception:
        disconnect_event.set()

await asyncio.gather(redis_to_ws(), ws_to_handler(), return_exceptions=True)
```

The `finally` block (unsubscribe, connection cleanup) remains unchanged.

---

## Files Changed

| File | Change |
|------|--------|
| `nginx/nginx.conf` | Add dedicated `/api/v1/ws/` location block with 3600s timeouts before the general `/api/` block |
| `api/app/routers/websocket.py` | Rewrite main loop as two concurrent asyncio tasks with shared `disconnect_event` |
| `docker-compose.yml` | Only if primary localhost fix fails — change port `80:80` → `8080:80` |

The localhost fix is a Windows system change (stop conflicting service), not a code change.

---

## Testing

1. After stopping the conflicting service, verify `localhost` loads the app
2. Connect to device visualization — WebSocket should connect (check Network → WS tab in DevTools, look for status 101)
3. Send test telemetry via MQTT — the visualization should update in real time without page refresh
4. Leave the page open for 2+ minutes with no telemetry — connection should stay alive (was dying after 60s before)
5. Verify CPU usage of the `gito-api` container is not spiking when WebSocket clients are connected
