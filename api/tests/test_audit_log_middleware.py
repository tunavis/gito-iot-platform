"""Tests for the audit-log middleware — audit_logs had a read API and RLS but
no write path anywhere in the codebase; every request was auditable but none
were ever recorded. This is centralized as middleware rather than instrumented
per-router (19+ routers) since a router that forgets the call silently never
gets audited.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.middleware import _parse_audit_target, audit_log_middleware

TENANT_ID = "aaaaaaaa-0000-0000-0000-000000000001"
DEVICE_ID = "dddddddd-0000-0000-0000-000000000002"


class TestParseAuditTarget:
    def test_resource_with_id(self):
        assert _parse_audit_target(f"/api/v1/tenants/{TENANT_ID}/devices/{DEVICE_ID}") == (
            TENANT_ID, "devices", DEVICE_ID,
        )

    def test_resource_without_id(self):
        assert _parse_audit_target(f"/api/v1/tenants/{TENANT_ID}/devices") == (
            TENANT_ID, "devices", None,
        )

    def test_multi_segment_resource_path(self):
        # Trailing segment "execute" isn't a UUID, so it stays part of
        # resource_type (verbose, but not wrong) and there's no resource_id.
        result = _parse_audit_target(f"/api/v1/tenants/{TENANT_ID}/ota/campaigns/{DEVICE_ID}/execute")
        assert result == (TENANT_ID, f"ota/campaigns/{DEVICE_ID}/execute", None)

    def test_non_tenant_path_returns_none(self):
        assert _parse_audit_target("/api/v1/auth/login") is None

    def test_bare_tenant_path_returns_none(self):
        assert _parse_audit_target(f"/api/v1/tenants/{TENANT_ID}") is None
        assert _parse_audit_target(f"/api/v1/tenants/{TENANT_ID}/") is None


class TestAuditLogMiddleware:
    @pytest.mark.asyncio
    async def test_writes_row_for_successful_post(self):
        request = MagicMock()
        request.method = "POST"
        request.url.path = f"/api/v1/tenants/{TENANT_ID}/devices"
        request.headers = {"authorization": "Bearer faketoken", "user-agent": "pytest"}
        request.client.host = "10.0.0.5"

        response = MagicMock(status_code=201)
        call_next = AsyncMock(return_value=response)

        session = AsyncMock()
        session.set_tenant_context = AsyncMock()
        session.add = MagicMock()
        session.commit = AsyncMock()
        session_ctx = AsyncMock()
        session_ctx.__aenter__ = AsyncMock(return_value=session)
        session_ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("app.middleware._SessionLocal", return_value=session_ctx), \
             patch("app.middleware.decode_token", return_value={"sub": str(uuid4())}):
            result = await audit_log_middleware(request, call_next)

        assert result is response
        call_next.assert_awaited_once_with(request)
        session.add.assert_called_once()
        logged = session.add.call_args.args[0]
        assert str(logged.tenant_id) == TENANT_ID
        assert logged.action == "create"
        assert logged.resource_type == "devices"
        assert logged.ip_address == "10.0.0.5"
        session.commit.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_get_requests_are_never_audited(self):
        request = MagicMock()
        request.method = "GET"
        request.url.path = f"/api/v1/tenants/{TENANT_ID}/devices"
        response = MagicMock(status_code=200)
        call_next = AsyncMock(return_value=response)

        with patch("app.middleware._SessionLocal") as mock_session_local:
            result = await audit_log_middleware(request, call_next)

        assert result is response
        mock_session_local.assert_not_called()

    @pytest.mark.asyncio
    async def test_failed_mutation_is_not_audited(self):
        request = MagicMock()
        request.method = "DELETE"
        request.url.path = f"/api/v1/tenants/{TENANT_ID}/devices/{DEVICE_ID}"
        response = MagicMock(status_code=404)
        call_next = AsyncMock(return_value=response)

        with patch("app.middleware._SessionLocal") as mock_session_local:
            result = await audit_log_middleware(request, call_next)

        assert result is response
        mock_session_local.assert_not_called()

    @pytest.mark.asyncio
    async def test_db_failure_does_not_break_the_response(self):
        request = MagicMock()
        request.method = "POST"
        request.url.path = f"/api/v1/tenants/{TENANT_ID}/devices"
        request.headers = {}
        request.client.host = "10.0.0.5"
        response = MagicMock(status_code=201)
        call_next = AsyncMock(return_value=response)

        with patch("app.middleware._SessionLocal", side_effect=RuntimeError("db down")):
            result = await audit_log_middleware(request, call_next)

        assert result is response  # Audit failure must never surface to the caller
