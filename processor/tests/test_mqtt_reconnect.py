"""run_loop() must survive a dropped broker connection.

Regression: run_loop() wrapped one aiomqtt connection in a bare try/except.
The first MqttError returned from it permanently, main()'s gather() kept the
process alive on the bridge manager alone, and the platform ingested nothing
for 43h while the container healthcheck stayed green.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import asyncio
import pytest
from unittest.mock import AsyncMock, patch

import mqtt_processor
from mqtt_processor import MQTTProcessor


def _processor():
    p = MQTTProcessor.__new__(MQTTProcessor)  # no DB/Redis connections
    p.running = True
    return p


@pytest.mark.asyncio
async def test_run_loop_reconnects_after_connection_error():
    p = _processor()
    attempts = []

    async def flaky():
        attempts.append(1)
        if len(attempts) < 3:
            raise OSError("broker went away")
        p.running = False  # third connection "succeeds", then we shut down

    with patch.object(p, "_run_mqtt_connection", side_effect=flaky), \
         patch.object(mqtt_processor.asyncio, "sleep", new=AsyncMock()):
        await p.run_loop()

    assert len(attempts) == 3, "run_loop stopped reconnecting after an error"


@pytest.mark.asyncio
async def test_run_loop_backs_off_exponentially_then_resets():
    p = _processor()
    delays = []

    async def always_fails():
        if len(delays) >= 3:
            p.running = False
            return
        raise OSError("broker went away")

    async def fake_sleep(d):
        delays.append(d)

    with patch.object(p, "_run_mqtt_connection", side_effect=always_fails), \
         patch.object(mqtt_processor.asyncio, "sleep", new=fake_sleep):
        await p.run_loop()

    assert delays == [
        mqtt_processor.BRIDGE_BACKOFF_BASE_S,
        mqtt_processor.BRIDGE_BACKOFF_BASE_S * 2,
        mqtt_processor.BRIDGE_BACKOFF_BASE_S * 4,
    ], f"unexpected backoff schedule: {delays}"


@pytest.mark.asyncio
async def test_run_loop_exits_on_cancellation():
    """Shutdown must not be swallowed by the reconnect loop."""
    p = _processor()

    with patch.object(p, "_run_mqtt_connection", side_effect=asyncio.CancelledError):
        with pytest.raises(asyncio.CancelledError):
            await p.run_loop()
