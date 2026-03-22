"""Unit tests for the DigitalTwinService."""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

from app.services.digital_twin import DigitalTwinService, _cache_key


DEVICE_ID = UUID("12345678-1234-5678-1234-567812345678")
DEVICE_ID_STR = str(DEVICE_ID)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _b(s: str) -> bytes:
    return s.encode()


def _make_redis(hgetall_return=None):
    """Return a mock async redis client."""
    redis = MagicMock()
    redis.hset = AsyncMock(return_value=1)
    redis.hgetall = AsyncMock(return_value=hgetall_return or {})
    return redis


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_update_device_state():
    """hset is called with the correct key and flattened metrics."""
    redis = _make_redis()
    svc = DigitalTwinService(redis)

    metrics = {"temperature": 23.5, "humidity": 60.0}
    await svc.update_device_state(DEVICE_ID, metrics, timestamp="2026-01-01T00:00:00+00:00")

    expected_key = f"device:{DEVICE_ID}:latest"
    redis.hset.assert_called_once()
    call_kwargs = redis.hset.call_args
    assert call_kwargs[0][0] == expected_key
    mapping = call_kwargs[1]["mapping"]
    assert mapping["_updated_at"] == "2026-01-01T00:00:00+00:00"
    assert mapping["temperature"] == "23.5"
    assert mapping["humidity"] == "60.0"


@pytest.mark.asyncio
async def test_update_device_state_json_value():
    """Dict/list values are JSON-serialised before storing."""
    redis = _make_redis()
    svc = DigitalTwinService(redis)

    metrics = {"config": {"a": 1}, "tags": ["x", "y"]}
    await svc.update_device_state(DEVICE_ID_STR, metrics)

    mapping = redis.hset.call_args[1]["mapping"]
    assert json.loads(mapping["config"]) == {"a": 1}
    assert json.loads(mapping["tags"]) == ["x", "y"]


@pytest.mark.asyncio
async def test_get_device_state():
    """hgetall bytes are decoded; numeric strings are cast to float."""
    raw = {
        _b("_updated_at"): _b("2026-01-01T00:00:00+00:00"),
        _b("temperature"): _b("23.5"),
        _b("status"): _b("online"),
    }
    redis = _make_redis(hgetall_return=raw)
    svc = DigitalTwinService(redis)

    state = await svc.get_device_state(DEVICE_ID)

    assert state is not None
    assert state["_updated_at"] == "2026-01-01T00:00:00+00:00"
    assert state["temperature"] == 23.5
    assert state["status"] == "online"


@pytest.mark.asyncio
async def test_get_device_state_empty():
    """Empty hgetall (no cached data) returns None."""
    redis = _make_redis(hgetall_return={})
    svc = DigitalTwinService(redis)

    result = await svc.get_device_state(DEVICE_ID)
    assert result is None


@pytest.mark.asyncio
async def test_get_device_state_json_field():
    """JSON-serialised field values are parsed back to Python objects."""
    raw = {
        _b("_updated_at"): _b("2026-01-01T00:00:00+00:00"),
        _b("config"): _b('{"threshold": 30}'),
    }
    redis = _make_redis(hgetall_return=raw)
    svc = DigitalTwinService(redis)

    state = await svc.get_device_state(DEVICE_ID)
    assert state["config"] == {"threshold": 30}


@pytest.mark.asyncio
async def test_get_multiple_device_states():
    """Pipeline is used; results are keyed by UUID; empty devices are skipped."""
    device_a = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    device_b = UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
    device_c = UUID("cccccccc-cccc-cccc-cccc-cccccccccccc")

    raw_a = {_b("_updated_at"): _b("2026-01-01T00:00:00+00:00"), _b("temp"): _b("10.0")}
    raw_b = {}  # no cached data
    raw_c = {_b("_updated_at"): _b("2026-01-01T01:00:00+00:00"), _b("temp"): _b("20.0")}

    # Build mock pipeline
    pipe = MagicMock()
    pipe.hgetall = MagicMock()
    pipe.execute = AsyncMock(return_value=[raw_a, raw_b, raw_c])

    redis = MagicMock()
    redis.pipeline = MagicMock(return_value=pipe)

    svc = DigitalTwinService(redis)
    states = await svc.get_multiple_device_states([device_a, device_b, device_c])

    # device_b had empty result — should be absent
    assert device_a in states
    assert device_b not in states
    assert device_c in states
    assert states[device_a]["temp"] == 10.0
    assert states[device_c]["temp"] == 20.0


@pytest.mark.asyncio
async def test_get_multiple_device_states_empty_list():
    """Empty input returns empty dict without touching Redis."""
    redis = MagicMock()
    svc = DigitalTwinService(redis)

    result = await svc.get_multiple_device_states([])
    assert result == {}
    redis.pipeline.assert_not_called()
