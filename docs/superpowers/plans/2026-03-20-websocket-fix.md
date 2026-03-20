# WebSocket Fix & localhost Conflict Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two issues that prevent real-time telemetry from working in device visualization: a Windows port conflict blocking `localhost`, and a broken WebSocket loop that never delivers data to the browser.

**Architecture:** The localhost fix is a Windows system diagnostic (find and stop whatever owns port 80). The WebSocket fix has two parts: a dedicated nginx location block with extended timeouts for WS paths, and a rewrite of the WebSocket main loop from a CPU-burning busy-spin into two concurrent asyncio tasks coordinated via a shared `asyncio.Event`.

**Tech Stack:** nginx 1.27, FastAPI 0.104, Python 3.11, redis.asyncio 5.0, pytest-asyncio 0.21

**Spec:** `docs/superpowers/specs/2026-03-20-websocket-fix-design.md`

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `nginx/nginx.conf` | Modify | Add `/api/v1/ws/` location block (before `/api/`) with 3600s timeouts |
| `api/app/routers/websocket.py` | Modify | Replace busy-spin loop (lines 145–182) with two concurrent asyncio tasks |
| `api/tests/__init__.py` | Create | Empty — marks `tests/` as a Python package |
| `api/tests/test_websocket_loop.py` | Create | Unit tests for the new loop functions |

---

## Task 1: Fix the localhost Port 80 Conflict

This is a Windows diagnostic task — no code changes. Run in Windows PowerShell (not WSL).

- [ ] **Step 1: Identify what is holding port 80**

  Open **Windows PowerShell as Administrator** and run:
  ```powershell
  netstat -ano | findstr ":80 "
  ```
  Look for a line with `LISTENING` and note the PID in the last column. Example output:
  ```
    TCP    0.0.0.0:80    0.0.0.0:0    LISTENING    4
    TCP    0.0.0.0:80    0.0.0.0:0    LISTENING    1234
  ```

- [ ] **Step 2: Identify the process name**

  ```powershell
  tasklist | findstr "<PID>"
  # Example: tasklist | findstr "1234"
  ```
  Common culprits and their fixes:

  | Process | What it is | Fix |
  |---------|-----------|-----|
  | `System` (PID 4) | IIS (Windows built-in web server) | See Step 3a |
  | `nginx.exe` | A standalone nginx install | Stop via Services |
  | `httpd.exe` | Apache (XAMPP/Laragon) | Stop via its tray icon or Services |
  | `com.docker.proxy.exe` | Another Docker container | `docker ps` to find it |

- [ ] **Step 3a: If IIS — stop and disable it**

  ```powershell
  # Stop IIS immediately
  iisreset /stop

  # Disable it permanently so it doesn't restart on reboot
  # Open Services: Win+R → services.msc
  # Find "World Wide Web Publishing Service" → set Startup type to "Manual" or "Disabled"
  ```

  Alternative via PowerShell:
  ```powershell
  Set-Service -Name W3SVC -StartupType Disabled
  Stop-Service -Name W3SVC
  ```

- [ ] **Step 4: Verify Docker nginx now owns port 80**

  Restart Docker's nginx container:
  ```bash
  # In WSL or Git Bash:
  docker restart gito-nginx
  ```

  Then open your browser to `http://localhost` — you should see the Gito app, not a default nginx or IIS page.

- [ ] **Step 5: Fallback only — if you need the conflicting service**

  If you cannot stop the conflicting service, remap Docker's nginx to port 8080 instead. Edit `docker-compose.yml`:
  ```yaml
  # Line 163 — change:
  ports:
    - "80:80"     # OLD
  # To:
  ports:
    - "8080:80"   # NEW
  ```
  Then restart: `docker compose up -d nginx`
  App will be at `http://localhost:8080`.

  > Skip this step if the primary fix worked.

---

## Task 2: Add nginx WebSocket Location Block

**Files:**
- Modify: `nginx/nginx.conf`

- [ ] **Step 1: Open `nginx/nginx.conf` and add the WebSocket block**

  Insert this new location block **before** the existing `/api/` block (currently at line 41). The more-specific prefix `/api/v1/ws/` must appear first so nginx matches it preferentially:

  ```nginx
  # WebSocket connections — long-lived, need extended timeouts
  # Must be before the /api/ block so the longer prefix matches first
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

  The resulting section of `nginx.conf` should look like:
  ```nginx
  server {
      listen 80;
      server_name _;

      # WebSocket connections (must be before /api/ — longer prefix wins)
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

      # API routes
      location /api/ {
          ...existing config...
      }
      ...
  ```

- [ ] **Step 2: Validate nginx config syntax**

  ```bash
  docker exec gito-nginx nginx -t
  ```
  Expected output:
  ```
  nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
  nginx: configuration file /etc/nginx/nginx.conf test is successful
  ```

- [ ] **Step 3: Reload nginx**

  ```bash
  docker exec gito-nginx nginx -s reload
  ```

- [ ] **Step 4: Verify WebSocket upgrade reaches the API (manual test)**

  Open Chrome DevTools → Network → filter "WS". Navigate to a device visualization page.
  The WebSocket connection should show status **101** (Switching Protocols). If it shows 404, the path is wrong. If it shows 403, authentication is failing.

- [ ] **Step 5: Commit**

  ```bash
  git add nginx/nginx.conf
  git commit -m "fix(nginx): add dedicated WebSocket location with 3600s timeout"
  ```

---

## Task 3: Rewrite WebSocket Main Loop (TDD)

**Files:**
- Create: `api/tests/__init__.py`
- Create: `api/tests/test_websocket_loop.py`
- Modify: `api/app/routers/websocket.py` (lines 145–182)

### Step 3a: Set up test infrastructure

- [ ] **Step 1: Create the tests package**

  ```bash
  touch api/tests/__init__.py
  ```

- [ ] **Step 2: Install dev dependencies inside the API container**

  ```bash
  docker exec gito-api pip install -e ".[dev]"
  ```
  Expected: installs pytest, pytest-asyncio, pytest-cov.

### Step 3b: Write failing tests

- [ ] **Step 3: Create `api/tests/test_websocket_loop.py` with these tests**

  ```python
  """Unit tests for the WebSocket main loop concurrency pattern."""
  import asyncio
  import json
  import pytest
  from unittest.mock import AsyncMock, MagicMock, patch
  from starlette.websockets import WebSocketDisconnect


  def _make_pubsub(messages):
      """
      Build a mock pubsub that yields messages from the list, then None forever.
      Each item in messages is a dict like {"data": json.dumps({...})} or None.
      """
      call_count = 0
      async def get_message(ignore_subscribe_messages=True):
          nonlocal call_count
          if call_count < len(messages):
              msg = messages[call_count]
              call_count += 1
              return msg
          return None
      mock = MagicMock()
      mock.get_message = get_message
      return mock


  @pytest.mark.asyncio
  async def test_redis_to_ws_forwards_telemetry_message():
      """redis_to_ws sends a telemetry message to the WebSocket when pub/sub delivers one."""
      payload = {"device_id": "abc", "temperature": 25.5, "timestamp": "2026-01-01T00:00:00"}
      telemetry_pubsub = _make_pubsub([{"data": json.dumps(payload)}])
      alerts_pubsub = _make_pubsub([])

      ws = MagicMock()
      ws.send_json = AsyncMock()

      disconnect_event = asyncio.Event()

      # Import the helper we're about to write
      from app.routers.websocket import _redis_to_ws

      # Cancel after one iteration
      async def cancel_after_send():
          await asyncio.sleep(0.05)
          disconnect_event.set()

      await asyncio.gather(
          _redis_to_ws(ws, telemetry_pubsub, alerts_pubsub, disconnect_event),
          cancel_after_send(),
          return_exceptions=True,
      )

      ws.send_json.assert_called_once_with({"type": "telemetry", "data": payload})


  @pytest.mark.asyncio
  async def test_redis_to_ws_sets_event_on_send_failure():
      """redis_to_ws sets disconnect_event when send_json raises (client disconnected)."""
      payload = {"device_id": "abc", "value": 1}
      telemetry_pubsub = _make_pubsub([{"data": json.dumps(payload)}])
      alerts_pubsub = _make_pubsub([])

      ws = MagicMock()
      ws.send_json = AsyncMock(side_effect=Exception("connection closed"))

      disconnect_event = asyncio.Event()

      from app.routers.websocket import _redis_to_ws

      await _redis_to_ws(ws, telemetry_pubsub, alerts_pubsub, disconnect_event)

      assert disconnect_event.is_set()


  @pytest.mark.asyncio
  async def test_ws_to_handler_sets_event_on_disconnect():
      """ws_to_handler sets disconnect_event when the client disconnects."""
      ws = MagicMock()
      ws.receive_json = AsyncMock(side_effect=WebSocketDisconnect(code=1000))

      disconnect_event = asyncio.Event()

      from app.routers.websocket import _ws_to_handler

      await _ws_to_handler(ws, disconnect_event)

      assert disconnect_event.is_set()


  @pytest.mark.asyncio
  async def test_redis_to_ws_yields_when_idle():
      """redis_to_ws calls asyncio.sleep when no messages arrive (avoids busy-spin)."""
      telemetry_pubsub = _make_pubsub([])
      alerts_pubsub = _make_pubsub([])

      ws = MagicMock()
      ws.send_json = AsyncMock()

      disconnect_event = asyncio.Event()
      sleep_called = False

      original_sleep = asyncio.sleep

      async def tracking_sleep(n):
          nonlocal sleep_called
          if n <= 0.05:  # our idle sleep
              sleep_called = True
              disconnect_event.set()  # stop the loop after first idle sleep
          await original_sleep(0)

      from app.routers.websocket import _redis_to_ws

      with patch("app.routers.websocket.asyncio") as mock_asyncio:
          mock_asyncio.sleep = tracking_sleep
          mock_asyncio.Event = asyncio.Event
          mock_asyncio.gather = asyncio.gather
          await _redis_to_ws(ws, telemetry_pubsub, alerts_pubsub, disconnect_event)

      assert sleep_called, "redis_to_ws must call asyncio.sleep when idle"
  ```

- [ ] **Step 4: Run the tests — expect ImportError (functions don't exist yet)**

  ```bash
  docker exec gito-api python -m pytest tests/test_websocket_loop.py -v
  ```
  Expected: `ImportError: cannot import name '_redis_to_ws' from 'app.routers.websocket'`

  This confirms the tests are wired up correctly and will fail for the right reason.

### Step 3c: Implement the fix

- [ ] **Step 5: Add `import asyncio` to `websocket.py`**

  At the top of `api/app/routers/websocket.py`, insert this single line after the module docstring, before the other imports:
  ```python
  import asyncio
  ```

- [ ] **Step 6: Add the two helper functions to `websocket.py`**

  Add these two functions at the **end of the file**, after the `_handle_websocket_message` function:

  ```python
  async def _redis_to_ws(
      websocket: WebSocket,
      telemetry_pubsub: PubSub,
      alerts_pubsub: PubSub,
      disconnect_event: asyncio.Event,
  ) -> None:
      """
      Forwards Redis pub/sub messages to the WebSocket client.
      Runs as a concurrent task alongside _ws_to_handler.
      Sets disconnect_event and exits if the WebSocket send fails.
      Yields to the event loop via asyncio.sleep(0.01) when no messages arrive.
      """
      while not disconnect_event.is_set():
          had_message = False

          message = await telemetry_pubsub.get_message(ignore_subscribe_messages=True)
          if message:
              had_message = True
              try:
                  data = json.loads(message["data"])
                  await websocket.send_json({"type": "telemetry", "data": data})
              except (json.JSONDecodeError, KeyError) as e:
                  logger.error(f"Failed to parse telemetry message: {e}")
              except Exception:
                  disconnect_event.set()
                  return

          message = await alerts_pubsub.get_message(ignore_subscribe_messages=True)
          if message:
              had_message = True
              try:
                  data = json.loads(message["data"])
                  await websocket.send_json({"type": "alert", "data": data})
              except (json.JSONDecodeError, KeyError) as e:
                  logger.error(f"Failed to parse alert message: {e}")
              except Exception:
                  disconnect_event.set()
                  return

          if not had_message:
              await asyncio.sleep(0.01)


  async def _ws_to_handler(
      websocket: WebSocket,
      disconnect_event: asyncio.Event,
  ) -> None:
      """
      Receives messages from the WebSocket client and dispatches them to handlers.
      Runs as a concurrent task alongside _redis_to_ws.
      Sets disconnect_event when the client disconnects or an error occurs.
      """
      try:
          while not disconnect_event.is_set():
              client_msg = await websocket.receive_json(mode="text")
              await _handle_websocket_message(websocket, client_msg)
      except WebSocketDisconnect:
          disconnect_event.set()
      except Exception:
          disconnect_event.set()
  ```

  Also add a separate import for `WebSocketDisconnect` at the top of the file (`WebSocketDisconnect` is in `starlette`, not `fastapi.websockets`):
  ```python
  from starlette.websockets import WebSocketDisconnect
  ```

- [ ] **Step 7: Replace the busy-spin loop with `asyncio.gather`**

  In `api/app/routers/websocket.py`, replace lines 145–182 (the `try: while True:` block) with:

  ```python
          try:
              disconnect_event = asyncio.Event()
              await asyncio.gather(
                  _redis_to_ws(websocket, telemetry_pubsub, alerts_pubsub, disconnect_event),
                  _ws_to_handler(websocket, disconnect_event),
                  return_exceptions=True,
              )
  ```

  The `except Exception` block at line 184 and the `finally` block at line 193 remain **unchanged**.

- [ ] **Step 8: Run the tests — expect all to pass**

  ```bash
  docker exec gito-api python -m pytest tests/test_websocket_loop.py -v
  ```
  Expected output:
  ```
  PASSED tests/test_websocket_loop.py::test_redis_to_ws_forwards_telemetry_message
  PASSED tests/test_websocket_loop.py::test_redis_to_ws_sets_event_on_send_failure
  PASSED tests/test_websocket_loop.py::test_ws_to_handler_sets_event_on_disconnect
  PASSED tests/test_websocket_loop.py::test_redis_to_ws_yields_when_idle

  4 passed
  ```

- [ ] **Step 9: Commit**

  ```bash
  git add api/tests/__init__.py api/tests/test_websocket_loop.py api/app/routers/websocket.py
  git commit -m "fix(websocket): replace busy-spin loop with concurrent asyncio tasks

  The old loop called receive_json() in a bare except block, causing it to
  spin at full CPU while never delivering Redis pub/sub messages to the client.
  Two concurrent tasks now handle Redis→WS forwarding and WS client messages
  independently, coordinated via a shared asyncio.Event."
  ```

---

## Task 4: End-to-End Verification

- [ ] **Step 1: Restart the stack**

  ```bash
  docker compose up -d
  ```

- [ ] **Step 2: Check API container logs for errors**

  ```bash
  docker logs gito-api --tail=50
  ```
  Should show no startup errors. Look for `Connected to Redis for WebSocket subscriptions`.

- [ ] **Step 3: Open a device visualization page and check WebSocket**

  Open Chrome, navigate to a device detail/visualization page.
  Open DevTools → Network → click "WS" filter.
  You should see a row for `ws://localhost/api/v1/ws/devices/<id>?token=...` with status **101**.

- [ ] **Step 4: Verify live data (send MQTT telemetry)**

  If you have a device sending MQTT data, watch the WS connection in DevTools → click the WS row → Messages tab. You should see incoming JSON frames like:
  ```json
  {"type": "telemetry", "data": {"device_id": "...", "temperature": 24.1, "timestamp": "..."}}
  ```

- [ ] **Step 5: Verify idle connections survive 2+ minutes**

  Leave the page open for 2 minutes with no MQTT traffic. The WS connection should remain **open** (not close after 60s as it did before).

- [ ] **Step 6: Verify CPU is not spiking**

  ```bash
  docker stats gito-api --no-stream
  ```
  With a WebSocket client connected but idle, CPU should be near **0%**, not 100%.
