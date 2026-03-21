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
