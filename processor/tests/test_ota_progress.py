"""Tests for MQTTProcessor._handle_ota_progress.

Devices report OTA progress back through their normal telemetry channel using
reserved keys (ota_status/ota_progress/ota_error) — see
api/app/services/ota_dispatch.py's module docstring. Nothing consumed these
keys anywhere in the codebase before this; this is the one place that does.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import AsyncMock, MagicMock

from mqtt_processor import MQTTProcessor

TENANT_ID = "aaaaaaaa-0000-0000-0000-000000000001"
DEVICE_ID = "dddddddd-0000-0000-0000-000000000001"


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


class TestHandleOtaProgress:
    @pytest.mark.asyncio
    async def test_no_ota_status_is_a_noop(self):
        processor, conn = _make_processor()
        await processor._handle_ota_progress(TENANT_ID, DEVICE_ID, {"temperature": 22.5})
        conn.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_downloading_maps_to_in_progress_with_percent(self):
        processor, conn = _make_processor()
        await processor._handle_ota_progress(
            TENANT_ID, DEVICE_ID,
            {"ota_status": "downloading", "ota_progress": 42},
        )
        # execute() is called twice: SELECT set_config(...) for RLS, then the UPDATE.
        assert conn.execute.await_count == 2
        sql, params = conn.execute.await_args.args
        assert "status = %s" in sql
        assert "progress_percent = %s" in sql
        assert "in_progress" in params
        assert 42 in params
        assert TENANT_ID in params and DEVICE_ID in params
        conn.commit.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_completed_sets_completed_at(self):
        processor, conn = _make_processor()
        await processor._handle_ota_progress(
            TENANT_ID, DEVICE_ID, {"ota_status": "completed", "ota_progress": 100},
        )
        sql, params = conn.execute.await_args.args
        assert "completed_at = now()" in sql
        assert "completed" in params

    @pytest.mark.asyncio
    async def test_failed_records_error_message(self):
        processor, conn = _make_processor()
        await processor._handle_ota_progress(
            TENANT_ID, DEVICE_ID,
            {"ota_status": "failed", "ota_error": "flash write failed"},
        )
        sql, params = conn.execute.await_args.args
        assert "error_message = %s" in sql
        assert "failed" in params
        assert "flash write failed" in params
        assert "completed_at = now()" in sql

    @pytest.mark.asyncio
    async def test_query_scopes_by_tenant_through_campaign_join(self):
        # ota_campaign_devices has no tenant_id column and no RLS policy of its
        # own — the join to ota_campaigns is the actual tenant boundary.
        processor, conn = _make_processor()
        await processor._handle_ota_progress(
            TENANT_ID, DEVICE_ID, {"ota_status": "completed"},
        )
        sql, _ = conn.execute.await_args.args
        assert "JOIN ota_campaigns oc ON oc.id = ocd.campaign_id" in sql
        assert "oc.tenant_id = %s::uuid" in sql
