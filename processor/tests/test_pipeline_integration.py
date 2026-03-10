"""
Integration tests for the MQTT telemetry pipeline.

Covers the StreamConsumer._process_entries and DatabaseService.batch_insert_telemetry
at-least-once delivery contract, plus MQTTProcessor.process_telemetry gating logic.

No real database, Redis, or MQTT broker is used — all external deps are mocked.
Consistent with conftest.py which stubs aiomqtt, redis, psycopg, psycopg_pool at import time.
"""

import asyncio
import json
import sys
import os
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch, call

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from mqtt_processor import (
    StreamConsumer,
    DatabaseService,
    TelemetryValidator,
    PENDING_CLAIM_MS,
    RATE_LIMIT_PER_MINUTE,
)


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures / helpers
# ─────────────────────────────────────────────────────────────────────────────

TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001"
TENANT_B = "bbbbbbbb-0000-0000-0000-000000000002"
DEVICE_A = "dddddddd-0000-0000-0000-000000000001"
DEVICE_B = "dddddddd-0000-0000-0000-000000000002"
TS = "2026-01-01T12:00:00"


def _stream_entry(msg_id: str, tenant_id: str, device_id: str, payload: dict) -> tuple:
    """Build a raw stream entry as xreadgroup returns it."""
    return (msg_id, {
        "tenant_id": tenant_id,
        "device_id": device_id,
        "payload": json.dumps(payload),
        "timestamp": TS,
    })


def _make_consumer(batch_insert_return: set | None = None):
    """
    Create a StreamConsumer with fully mocked db and redis services.
    batch_insert_return: value returned by db.batch_insert_telemetry
                         (default: empty set = full success)
    """
    db = MagicMock(spec=DatabaseService)
    db.get_unit_map = AsyncMock(return_value={})
    db.batch_insert_telemetry = AsyncMock(
        return_value=set() if batch_insert_return is None else batch_insert_return
    )
    redis = MagicMock()
    consumer = StreamConsumer.__new__(StreamConsumer)
    consumer.db = db
    consumer.redis = redis
    consumer._running = True
    return consumer, db, redis


# ─────────────────────────────────────────────────────────────────────────────
# 1. _process_entries — at-least-once delivery
# ─────────────────────────────────────────────────────────────────────────────

class TestProcessEntriesAckSemantics:

    def test_acks_all_on_success(self):
        """All msg_ids returned when batch_insert returns empty failed set."""
        consumer, db, _ = _make_consumer(batch_insert_return=set())
        entries = [
            _stream_entry("1-1", TENANT_A, DEVICE_A, {"temp": 24.5}),
            _stream_entry("1-2", TENANT_A, DEVICE_A, {"humidity": 61.0}),
        ]
        result = asyncio.run(consumer._process_entries(entries))
        assert set(result) == {"1-1", "1-2"}
        db.batch_insert_telemetry.assert_called_once()

    def test_no_ack_on_insert_failure_for_failed_tenant(self):
        """
        When batch_insert returns TENANT_A as failed:
        - TENANT_A msg_id is NOT in the returned ack list
        - TENANT_B msg_id IS in the returned ack list
        """
        consumer, db, _ = _make_consumer(batch_insert_return={TENANT_A})
        entries = [
            _stream_entry("1-1", TENANT_A, DEVICE_A, {"temp": 24.5}),
            _stream_entry("2-1", TENANT_B, DEVICE_B, {"pressure": 101.3}),
        ]
        result = asyncio.run(consumer._process_entries(entries))
        assert "1-1" not in result, "Failed tenant's message must NOT be ACKed"
        assert "2-1" in result,     "Successful tenant's message MUST be ACKed"

    def test_acks_malformed_entries_unconditionally(self):
        """
        Malformed entries (bad JSON, missing keys) are always ACKed so they
        cannot block the stream. No DB insert is attempted.
        """
        consumer, db, _ = _make_consumer()
        entries = [
            ("bad-1", {"tenant_id": TENANT_A, "device_id": DEVICE_A,
                       "payload": "{{broken json", "timestamp": TS}),
            ("bad-2", {"wrong_key": "no required fields here"}),
        ]
        result = asyncio.run(consumer._process_entries(entries))
        assert "bad-1" in result
        assert "bad-2" in result
        db.batch_insert_telemetry.assert_not_called()

    def test_single_batch_insert_call_for_multiple_tenants(self):
        """
        Entries from two tenants produce exactly ONE batch_insert_telemetry call
        containing rows for both — grouping happens inside batch_insert, not here.
        """
        consumer, db, _ = _make_consumer(batch_insert_return=set())
        entries = [
            _stream_entry("1-1", TENANT_A, DEVICE_A, {"temp": 24.5}),
            _stream_entry("2-1", TENANT_B, DEVICE_B, {"temp": 18.0}),
        ]
        result = asyncio.run(consumer._process_entries(entries))
        db.batch_insert_telemetry.assert_called_once()
        rows_arg = db.batch_insert_telemetry.call_args[0][0]
        tenant_ids_in_rows = {r[0] for r in rows_arg}
        assert TENANT_A in tenant_ids_in_rows
        assert TENANT_B in tenant_ids_in_rows
        assert set(result) == {"1-1", "2-1"}

    def test_empty_payload_messages_still_acked(self):
        """
        A message whose payload produces zero rows (all None values) should
        still be ACKed — it decoded correctly, just had nothing to insert.
        """
        consumer, db, _ = _make_consumer(batch_insert_return=set())
        # Payload with all-None values produces no rows
        entries = [
            _stream_entry("1-1", TENANT_A, DEVICE_A, {}),
        ]
        result = asyncio.run(consumer._process_entries(entries))
        assert "1-1" in result
        db.batch_insert_telemetry.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# 2. batch_insert_telemetry — return type contract
# ─────────────────────────────────────────────────────────────────────────────

class TestBatchInsertReturnType:

    def test_returns_empty_set_on_full_success(self):
        """batch_insert_telemetry returns set[str], empty when all succeed."""
        consumer, db, _ = _make_consumer(batch_insert_return=set())
        entries = [_stream_entry("1-1", TENANT_A, DEVICE_A, {"temp": 20.0})]
        result = asyncio.run(consumer._process_entries(entries))
        # Ensure the return value was used (not ignored)
        assert isinstance(result, list)
        assert "1-1" in result

    def test_returns_failed_tenant_ids_on_error(self):
        """When batch_insert returns {TENANT_A}, those messages are not ACKed."""
        consumer, db, _ = _make_consumer(batch_insert_return={TENANT_A})
        entries = [_stream_entry("1-1", TENANT_A, DEVICE_A, {"temp": 20.0})]
        result = asyncio.run(consumer._process_entries(entries))
        assert "1-1" not in result


# ─────────────────────────────────────────────────────────────────────────────
# 3. process_telemetry — topic + UUID validation gating
# ─────────────────────────────────────────────────────────────────────────────

def _make_processor_mock(
    *,
    device_exists: bool = True,
    set_nx_return=1,
    incr_return: int = 1,
):
    """
    Build a MQTTProcessor instance with all external services mocked.
    Returns (processor, mock_stream_add).
    """
    from mqtt_processor import MQTTProcessor

    processor = MQTTProcessor.__new__(MQTTProcessor)
    processor.validator = TelemetryValidator()

    # DB service mock
    processor.db_service = MagicMock()
    processor.db_service.device_exists = AsyncMock(return_value=device_exists)
    processor.db_service.get_active_alert_rules = AsyncMock(return_value=[])

    # Redis service mock
    mock_redis = AsyncMock()
    mock_redis.set = AsyncMock(return_value=set_nx_return)
    mock_redis.incr = AsyncMock(return_value=incr_return)
    mock_redis.expire = AsyncMock(return_value=True)
    processor.redis_service = MagicMock()
    processor.redis_service.redis = mock_redis
    mock_stream_add = AsyncMock(return_value="1-1")
    processor.redis_service.stream_add = mock_stream_add
    processor.redis_service.publish_telemetry = AsyncMock()

    processor.running = True
    return processor, mock_stream_add


class TestProcessTelemetryGating:

    def test_invalid_topic_5_parts_rejected(self):
        """Topic with 5 segments is rejected; stream_add is never called."""
        processor, stream_add = _make_processor_mock()
        bad_topic = f"{TENANT_A}/extra/devices/{DEVICE_A}/telemetry"
        asyncio.run(processor.process_telemetry(bad_topic, b'{"temp": 24.5}'))
        stream_add.assert_not_called()

    def test_invalid_topic_missing_devices_keyword_rejected(self):
        """Topic where second segment isn't 'devices' is rejected."""
        processor, stream_add = _make_processor_mock()
        bad_topic = f"{TENANT_A}/sensors/{DEVICE_A}/telemetry"
        asyncio.run(processor.process_telemetry(bad_topic, b'{"temp": 24.5}'))
        stream_add.assert_not_called()

    def test_invalid_uuid_tenant_rejected(self):
        """Non-UUID tenant_id causes early return; nothing written to stream."""
        processor, stream_add = _make_processor_mock()
        bad_topic = f"not-a-uuid/devices/{DEVICE_A}/telemetry"
        asyncio.run(processor.process_telemetry(bad_topic, b'{"temp": 24.5}'))
        stream_add.assert_not_called()

    def test_invalid_uuid_device_rejected(self):
        """Non-UUID device_id causes early return; nothing written to stream."""
        processor, stream_add = _make_processor_mock()
        bad_topic = f"{TENANT_A}/devices/not-a-uuid/telemetry"
        asyncio.run(processor.process_telemetry(bad_topic, b'{"temp": 24.5}'))
        stream_add.assert_not_called()

    def test_unknown_device_rejected(self):
        """device_exists returns False → stream_add never called."""
        processor, stream_add = _make_processor_mock(device_exists=False)
        topic = f"{TENANT_A}/devices/{DEVICE_A}/telemetry"
        asyncio.run(processor.process_telemetry(topic, b'{"temp": 24.5}'))
        stream_add.assert_not_called()

    def test_duplicate_message_rejected(self):
        """
        Same payload bytes twice: second call returns None from SET NX
        (key already exists) → second message is dropped, stream_add called once.
        """
        # First call: SET NX succeeds (returns 1), second: key exists (returns None)
        processor, stream_add = _make_processor_mock(set_nx_return=1)
        processor.redis_service.redis.set = AsyncMock(side_effect=[1, None])

        topic = f"{TENANT_A}/devices/{DEVICE_A}/telemetry"
        payload = b'{"temp": 24.5}'
        asyncio.run(processor.process_telemetry(topic, payload))
        asyncio.run(processor.process_telemetry(topic, payload))

        assert stream_add.call_count == 1

    def test_rate_limit_drops_excess_messages(self):
        """
        When Redis INCR returns a value > RATE_LIMIT_PER_MINUTE, the message
        is dropped and stream_add is not called.
        """
        processor, stream_add = _make_processor_mock(incr_return=RATE_LIMIT_PER_MINUTE + 1)
        topic = f"{TENANT_A}/devices/{DEVICE_A}/telemetry"
        asyncio.run(processor.process_telemetry(topic, b'{"temp": 24.5}'))
        stream_add.assert_not_called()

    def test_system_keys_stripped_before_stream(self):
        """
        Payload keys like 'timestamp', 'ts', 'device_id' are stripped before
        the message is forwarded to the KeyDB stream.
        """
        processor, stream_add = _make_processor_mock()
        topic = f"{TENANT_A}/devices/{DEVICE_A}/telemetry"
        payload = json.dumps({
            "temp": 24.5,
            "timestamp": "2026-01-01T00:00:00",
            "device_id": DEVICE_A,
            "ts": 1234567890,
        }).encode()
        asyncio.run(processor.process_telemetry(topic, payload))

        stream_add.assert_called_once()
        # Third positional arg to stream_add is the payload dict
        streamed_payload = stream_add.call_args[0][2]
        assert "timestamp" not in streamed_payload
        assert "device_id" not in streamed_payload
        assert "ts" not in streamed_payload
        assert "temp" in streamed_payload

    def test_valid_message_reaches_stream(self):
        """Happy path: valid topic + device + payload → stream_add called once."""
        processor, stream_add = _make_processor_mock()
        topic = f"{TENANT_A}/devices/{DEVICE_A}/telemetry"
        asyncio.run(processor.process_telemetry(topic, b'{"temp": 24.5}'))
        stream_add.assert_called_once()
