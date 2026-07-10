"""Regression test: JWT telemetry ingest must go through the shared stream
funnel (stream_ingest), not write Telemetry rows directly.

Writing rows directly (the old behavior) stored the data but bypassed the
processor's stream consumer entirely — which is where alarm evaluation
happens — so telemetry posted through this endpoint never triggered alarms.
See app/services/telemetry_stream.py's module docstring for the intended
single-funnel design.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from fastapi import HTTPException

from app.database import RLSSession
from app.routers.telemetry import ingest_telemetry


def _mock_session(device):
    session = MagicMock(spec=RLSSession)
    session.set_tenant_context = AsyncMock()
    device_result = MagicMock()
    device_result.scalar_one_or_none.return_value = device
    session.execute = AsyncMock(return_value=device_result)
    session.commit = AsyncMock()
    return session


def _mock_request():
    request = MagicMock()
    request.app.state.redis = MagicMock()
    request.app.state.redis.publish = AsyncMock()
    return request


class TestIngestTelemetryUsesStreamFunnel:
    @pytest.mark.asyncio
    async def test_publishes_to_stream_instead_of_writing_rows_directly(self):
        tenant_id = uuid4()
        device_id = uuid4()
        device = MagicMock(device_type_id=None)
        session = _mock_session(device)
        request = _mock_request()

        with patch("app.routers.telemetry.stream_ingest", new=AsyncMock()) as mock_stream_ingest, \
             patch("app.services.digital_twin.DigitalTwinService") as mock_twin_cls:
            mock_twin_cls.return_value.update_device_state = AsyncMock()

            response = await ingest_telemetry(
                request=request,
                tenant_id=tenant_id,
                device_id=device_id,
                session=session,
                current_tenant=tenant_id,
                payload={"temperature": 25.5, "humidity": 65.2},
            )

        mock_stream_ingest.assert_awaited_once()
        args, _ = mock_stream_ingest.await_args
        assert args[1] == tenant_id
        assert args[2] == device_id
        assert args[3] == {"temperature": 25.5, "humidity": 65.2}

        assert response.data["ingested"] == 2
        request.app.state.redis.publish.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_no_redis_client_returns_503_before_streaming(self):
        tenant_id = uuid4()
        device_id = uuid4()
        device = MagicMock(device_type_id=None)
        session = _mock_session(device)
        request = MagicMock()
        request.app.state.redis = None

        with patch("app.routers.telemetry.stream_ingest", new=AsyncMock()) as mock_stream_ingest:
            with pytest.raises(HTTPException) as exc_info:
                await ingest_telemetry(
                    request=request,
                    tenant_id=tenant_id,
                    device_id=device_id,
                    session=session,
                    current_tenant=tenant_id,
                    payload={"temperature": 25.5},
                )

        assert exc_info.value.status_code == 503
        mock_stream_ingest.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_stream_failure_returns_503(self):
        tenant_id = uuid4()
        device_id = uuid4()
        device = MagicMock(device_type_id=None)
        session = _mock_session(device)
        request = _mock_request()

        with patch(
            "app.routers.telemetry.stream_ingest",
            new=AsyncMock(side_effect=ConnectionError("redis down")),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await ingest_telemetry(
                    request=request,
                    tenant_id=tenant_id,
                    device_id=device_id,
                    session=session,
                    current_tenant=tenant_id,
                    payload={"temperature": 25.5},
                )

        assert exc_info.value.status_code == 503
