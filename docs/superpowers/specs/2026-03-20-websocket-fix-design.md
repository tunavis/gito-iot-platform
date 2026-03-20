# WebSocket Fix & localhost Conflict Resolution

**Date:** 2026-03-20
**Status:** Approved
**Scope:** Fix two blocking issues preventing real-time telemetry in device visualization

---

## Problem Summary

Two issues prevent the live WebSocket telemetry from working in local development:

1. **localhost conflict** — Something on Windows is listening on port 80 before Docker's nginx, so the app is only reachable via LAN IP (`192.168.0.9`), not `localhost`.
2. **WebSocket never delivers data** — The WebSocket connection appears to succeed but never forwards telemetry. Two root causes: nginx silently kills idle connections after 60s, and the WebSocket main loop is blocked on a call that never returns.

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

The `/api/` nginx location has no `proxy_read_timeout`. nginx default is 60 seconds — any WebSocket connection with no data for 60s is silently terminated. Device visualization pages connecting to a device with infrequent telemetry will see the connection die immediately.

### Change

**File:** `nginx/nginx.conf`
**Location:** `/api/` location block

Add:
```nginx
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
```

This keeps WebSocket connections alive for up to 1 hour of inactivity. The frontend reconnect logic (exponential backoff, max 10 attempts) handles the case where a connection does drop.

---

## Fix 3: WebSocket Main Loop Concurrency Bug

### Problem

In `api/app/routers/websocket.py`, the main loop (lines 147–182) has a blocking structure:

```python
while True:
    # 1. Check Redis — non-blocking, returns immediately
    message = await telemetry_pubsub.get_message(...)
    # 2. Check Redis — non-blocking, returns immediately
    message = await alerts_pubsub.get_message(...)
    # 3. ← BLOCKS HERE FOREVER waiting for client to send something
    client_msg = await websocket.receive_json(mode="text")
```

Since the browser never sends messages unprompted (it just watches), step 3 blocks indefinitely and Redis messages are never processed or forwarded.

### Fix: Two concurrent asyncio tasks

Replace the single blocking loop with two tasks running concurrently via `asyncio.gather()`:

**Task A — Redis → WebSocket:** Polls both pub/sub channels in a loop, forwards any messages to the client, uses a short `asyncio.sleep(0.01)` when idle to avoid busy-spinning.

**Task B — WebSocket → handler:** Awaits client messages (ping/pong), handles `WebSocketDisconnect` by raising a shared cancellation signal.

**Coordination:** Both tasks share a `asyncio.Event` called `disconnect_event`. When either task detects a disconnect or error, it sets the event and both tasks exit cleanly. `asyncio.gather()` runs both until one raises or the event fires.

```python
disconnect_event = asyncio.Event()

async def redis_to_ws():
    while not disconnect_event.is_set():
        msg = await telemetry_pubsub.get_message(ignore_subscribe_messages=True)
        if msg:
            await websocket.send_json({"type": "telemetry", "data": json.loads(msg["data"])})
        msg = await alerts_pubsub.get_message(ignore_subscribe_messages=True)
        if msg:
            await websocket.send_json({"type": "alert", "data": json.loads(msg["data"])})
        if not msg:
            await asyncio.sleep(0.01)

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
| `nginx/nginx.conf` | Add `proxy_read_timeout 3600s` and `proxy_send_timeout 3600s` to `/api/` location |
| `api/app/routers/websocket.py` | Rewrite main loop as two concurrent asyncio tasks |
| `docker-compose.yml` | Only if primary localhost fix fails — change port `80:80` → `8080:80` |

The localhost fix is a Windows system change (stop conflicting service), not a code change.

---

## Testing

1. After stopping the conflicting service, verify `localhost` loads the app
2. Connect to device visualization — WebSocket should connect (check Network → WS tab in DevTools, look for status 101)
3. Send test telemetry via MQTT — the visualization should update in real time without page refresh
4. Leave the page open for 2+ minutes with no telemetry — connection should stay alive (no disconnect after 60s)
