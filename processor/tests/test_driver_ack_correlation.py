"""Tests for MQTTProcessor._correlate_driver_ack — phase 2 of the driver model.

The existing correlation path matches on `command_id`, which only a device built
for this platform's own convention echoes back. No third-party device does. A
B METERS IWM answers with the same `Fct` byte it was sent; an RFM-LR1 echoes the
whole frame and refuses with `0x02 <Index>`. So this path keys on
**(device, opcode)** instead.

Every frame asserted here is quoted from a vendor manual.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import base64
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from mqtt_processor import MQTTProcessor

TENANT_ID = "aaaaaaaa-0000-0000-0000-000000000001"
DEVICE_ID = "dddddddd-0000-0000-0000-000000000001"

# The two acknowledgement declarations from `drivers/`, reduced to what this
# path reads. Kept literal rather than loaded from the JSON: this test asserts
# that a *declaration of this shape* is honoured, and the api-side suite is what
# checks the shipped files still have it.
IWM = {
    "acknowledgement": {
        "mode": "echo_opcode",
        "opcode_field": "fct",
        "response": {
            "opcode_offset": 0,
            "kind_offset": 1,
            "ack_values": [1],
            "error_offset": 2,
            "error_names": {"0x04": "Error length"},
        },
    }
}

RFM = {
    "acknowledgement": {
        "mode": "echo_frame",
        "opcode_field": "index",
        "response": {
            "opcode_offset": 1,
            "kind_offset": 0,
            "ack_values": [1],
            "nack_values": [2],
        },
    }
}


def _make_processor(rowcount: int = 1):
    """MQTTProcessor with __init__ skipped and db_service.conn_pool mocked."""
    processor = MQTTProcessor.__new__(MQTTProcessor)

    conn = AsyncMock()
    result = MagicMock()
    result.rowcount = rowcount
    conn.execute = AsyncMock(return_value=result)
    conn.commit = AsyncMock()

    conn_ctx = AsyncMock()
    conn_ctx.__aenter__ = AsyncMock(return_value=conn)
    conn_ctx.__aexit__ = AsyncMock(return_value=False)

    conn_pool = MagicMock()
    conn_pool.connection = MagicMock(return_value=conn_ctx)

    db_service = MagicMock()
    db_service.conn_pool = conn_pool
    processor.db_service = db_service

    return processor, conn


def _b64(*byte_values: int) -> str:
    return base64.b64encode(bytes(byte_values)).decode()


async def _correlate(driver, *byte_values, rowcount=1):
    processor, conn = _make_processor(rowcount)
    await processor._correlate_driver_ack(TENANT_ID, DEVICE_ID, driver, _b64(*byte_values))
    return conn


def _update_params(conn):
    """The UPDATE's parameters. execute() is called twice — RLS, then the write."""
    assert conn.execute.await_count == 2, "expected the RLS set_config and one UPDATE"
    sql, params = conn.execute.await_args.args
    assert "UPDATE device_commands" in sql
    return sql, params


class TestTheIWMStyle:
    """It echoes the opcode with C/R/A = 0x01 and carries the outcome in `Err`."""

    @pytest.mark.asyncio
    async def test_a_clean_answer_executes_the_command(self):
        # Manual p.21: SET_REVOLUTION_COUNTERS answer.
        conn = await _correlate(IWM, 0x16, 0x01, 0x00, 0x00, 0x00)
        sql, params = _update_params(conn)

        assert "executed" in params
        assert 0x16 in params, "the opcode is the correlation key"
        assert "opcode = %s" in sql
        assert None in params, "no error message on a clean answer"
        conn.commit.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_a_nonzero_error_byte_fails_it_with_the_devices_own_reason(self):
        # Manual p.21: GET FW VERSION with incorrect length → Err = 0x04.
        conn = await _correlate(IWM, 0x07, 0x01, 0x04, 0x00, 0x00)
        _, params = _update_params(conn)

        assert "failed" in params
        assert any(isinstance(p, str) and "Error length" in p for p in params), (
            "the device said why; recording only 'failed' throws that away"
        )

    @pytest.mark.asyncio
    async def test_an_unknown_error_code_still_fails_with_the_byte(self):
        conn = await _correlate(IWM, 0x07, 0x01, 0x7F, 0x00, 0x00)
        _, params = _update_params(conn)

        assert "failed" in params
        assert any(isinstance(p, str) and "0x7f" in p for p in params)

    @pytest.mark.asyncio
    async def test_the_command_frame_itself_is_not_an_answer(self):
        """C/R/A = 0x00 is a Command. If a downlink echoed back on some other
        path were read as an answer, a command would close itself."""
        conn = await _correlate(IWM, 0x16, 0x00, 0x00, 0x00, 0x06)
        conn.execute.assert_not_called()


class TestTheRFMStyle:
    """It echoes the whole frame, and has the only real NACK in either family."""

    @pytest.mark.asyncio
    async def test_an_echoed_set_executes_the_command(self):
        # Manual p.8: Downlink 012205A0 → Uplink 012205A0.
        conn = await _correlate(RFM, 0x01, 0x22, 0x05, 0xA0)
        _, params = _update_params(conn)

        assert "executed" in params
        assert 0x22 in params

    @pytest.mark.asyncio
    async def test_a_query_answer_executes_the_command(self):
        # Manual p.8: Downlink 0227 → Uplink 012700000017.
        conn = await _correlate(RFM, 0x01, 0x27, 0x00, 0x00, 0x00, 0x17)
        _, params = _update_params(conn)

        assert "executed" in params
        assert 0x27 in params

    @pytest.mark.asyncio
    async def test_a_nack_fails_the_command_rather_than_letting_it_time_out(self):
        """Task 5.5. The device said no. Waiting out a four-hour window and then
        recording 'timed_out' would describe a silent device, which is the
        opposite of what happened."""
        conn = await _correlate(RFM, 0x02, 0x2B)
        _, params = _update_params(conn)

        assert "failed" in params
        assert any(isinstance(p, str) and "refused" in p for p in params)
        assert 0x2B in params


class TestWhatMustNotBeMistakenForAnAnswer:
    """This runs on every uplink from a device with a driver."""

    @pytest.mark.asyncio
    async def test_a_device_type_with_no_acknowledgement_declaration_is_a_noop(self):
        conn = await _correlate({"transport": {"mode": "payload", "protocol": "lorawan"}}, 0x01, 0x22)
        conn.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_mode_none_is_a_noop(self):
        driver = {"acknowledgement": {"mode": "none", **RFM["acknowledgement"]}}
        driver["acknowledgement"]["mode"] = "none"
        conn = await _correlate(driver, 0x01, 0x22)
        conn.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_a_frame_too_short_to_hold_the_offsets_is_a_noop(self):
        conn = await _correlate(IWM, 0x16)
        conn.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_an_unrecognised_frame_kind_is_a_noop(self):
        conn = await _correlate(RFM, 0x09, 0x22)
        conn.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_undecodable_base64_does_not_raise(self):
        processor, conn = _make_processor()
        await processor._correlate_driver_ack(TENANT_ID, DEVICE_ID, IWM, "not base64 !!")
        conn.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_waiting_command_is_not_an_error(self):
        """A device re-sending an answer, or answering after its window closed.
        The UPDATE matches nothing and that is a normal outcome, not a failure."""
        conn = await _correlate(RFM, 0x01, 0x22, 0x05, 0xA0, rowcount=0)
        conn.commit.assert_awaited_once()


class TestWhatIsRecorded:
    @pytest.mark.asyncio
    async def test_the_raw_frame_is_kept_as_the_response(self):
        """So an operator can read what came back even where the platform
        cannot yet decode its payload — which for the IWM is today."""
        conn = await _correlate(RFM, 0x01, 0x27, 0x00, 0x00, 0x00, 0x17)
        _, params = _update_params(conn)

        recorded = next(
            json.loads(p) for p in params if isinstance(p, str) and p.startswith("{")
        )
        assert recorded["opcode"] == 0x27
        assert base64.b64decode(recorded["raw_b64"]).hex() == "012700000017"

    @pytest.mark.asyncio
    async def test_only_an_in_flight_command_is_closed(self):
        """A command already executed, failed, rejected or swept must not be
        rewritten by a late uplink."""
        conn = await _correlate(RFM, 0x01, 0x22, 0x05, 0xA0)
        sql, _ = _update_params(conn)
        assert "status IN ('pending', 'sent', 'delivered')" in sql

    @pytest.mark.asyncio
    async def test_the_tenant_context_is_set_before_the_write(self):
        conn = await _correlate(RFM, 0x01, 0x22, 0x05, 0xA0)
        first_sql, first_params = conn.execute.await_args_list[0].args
        assert "set_config" in first_sql and TENANT_ID in first_params
