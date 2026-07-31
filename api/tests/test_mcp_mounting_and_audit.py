"""Boot-time behaviour and audit coverage for the MCP server.

Tasks 6.3, 6.5 and 6.6. All three are about things that are correct today and
would fail quietly if they ever stopped being correct: a protocol pin that no
longer fails the boot, a `/mcp` route that exists when the feature is off, and
an agent read that leaves no trace.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

from contextlib import contextmanager
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from mcp.types import LATEST_PROTOCOL_VERSION

from app.config import get_settings
from app.mcp.auth import ToolContext
from app.mcp.server import ProtocolVersionMismatch, assert_protocol_version


def _settings_with(**overrides):
    """The real settings object with a few fields replaced.

    A copy rather than a mutation: `get_settings` is cached, and a test that
    edited the shared instance would leak into every test after it.
    """
    settings = get_settings()
    return MagicMock(
        **{k: getattr(settings, k) for k in ("APP_NAME", "API_VERSION", "APP_ENV")}, **overrides
    )


class TestProtocolPin:
    def test_the_pinned_version_matches_the_installed_sdk(self):
        assert assert_protocol_version() == LATEST_PROTOCOL_VERSION

    def test_a_mismatched_pin_fails_the_boot(self):
        """Task 6.5. The whole point of pinning is that a dependency bump cannot
        change wire behaviour without someone deciding to."""
        with patch(
            "app.mcp.server.get_settings",
            return_value=_settings_with(MCP_PROTOCOL_VERSION="1999-01-01"),
        ):
            with pytest.raises(ProtocolVersionMismatch) as exc:
                assert_protocol_version()
        assert "1999-01-01" in str(exc.value)
        assert LATEST_PROTOCOL_VERSION in str(exc.value)

    def test_the_error_does_not_suggest_widening_the_pin(self):
        """The message has to push toward a decision, not toward making it pass."""
        with patch(
            "app.mcp.server.get_settings",
            return_value=_settings_with(MCP_PROTOCOL_VERSION="1999-01-01"),
        ):
            with pytest.raises(ProtocolVersionMismatch) as exc:
                assert_protocol_version()
        assert "do not widen it" in str(exc.value)


@contextmanager
def _app_with_mcp(enabled: bool):
    """Build the app with MCP forced on or off, whatever the environment says.

    An earlier version of this asserted `not settings.MCP_ENABLED` and read the
    ambient config, so it passed only on a machine that happened to have MCP
    off — and started failing the moment MCP was switched on locally. A test
    whose result depends on the environment it runs in cannot tell you anything
    about the code, so it now sets the value it is testing.
    """
    from app.main import create_app

    forced = get_settings().model_copy(update={"MCP_ENABLED": enabled})
    with patch("app.main.get_settings", return_value=forced):
        yield create_app()


class TestMountingIsConditional:
    def test_disabled_means_the_route_does_not_exist(self):
        """Task 6.6. Not mounted at all, rather than mounted and refusing —
        a 404 is an honest answer about a feature that is switched off."""
        from fastapi.testclient import TestClient

        with _app_with_mcp(False) as app:
            assert not any(getattr(r, "path", "") == "/mcp" for r in app.routes)

            # And the rest of the API is unaffected. `/` rather than
            # `/api/health`: health probes the database, which this test does
            # not have, so a 503 there would say something about the
            # environment and nothing about MCP.
            with TestClient(app) as client:
                assert client.get("/mcp").status_code == 404
                assert client.get("/").status_code == 200

    def test_enabled_means_the_route_exists(self):
        """The other half. Without it, a bug that never mounts /mcp at all would
        pass the test above and look like correct behaviour."""
        with _app_with_mcp(True) as app:
            assert any(getattr(r, "path", "") == "/mcp" for r in app.routes)

    def test_health_reports_the_mcp_state_either_way(self):
        """The `mcp` check is reported whatever the overall status — MCP being
        off is a configuration choice, not a fault, and must not colour it."""
        from fastapi.testclient import TestClient

        for enabled, expected in ((False, "disabled"), (True, "enabled")):
            with _app_with_mcp(enabled) as app:
                with TestClient(app) as client:
                    mcp = client.get("/api/health").json()["checks"]["mcp"]
            assert mcp["status"] == expected
            assert mcp["protocol_version"] == get_settings().MCP_PROTOCOL_VERSION


class TestAuditCoverage:
    """Task 6.3 — N tool calls produce N audit rows, with the right actor."""

    @staticmethod
    def _capture():
        """A patched session that collects whatever `record_tool_call` adds."""
        written = []
        session = AsyncMock()
        session.add = MagicMock(side_effect=written.append)
        session.commit = AsyncMock()

        async def fake_get_session():
            yield session

        return written, fake_get_session

    @pytest.mark.asyncio
    async def test_every_call_writes_exactly_one_row(self):
        from app.mcp.audit import audited

        written, fake_get_session = self._capture()
        ctx = ToolContext(uuid4(), uuid4(), "TENANT_ADMIN")

        async def tool(ctx, device_id=None):
            return {"items": [1, 2, 3]}

        wrapped = audited("list_devices", tool)
        with patch("app.mcp.audit.get_session", new=fake_get_session):
            for _ in range(4):
                await wrapped(ctx, device_id="d")

        assert len(written) == 4
        for entry in written:
            assert entry.action == "mcp.tool.list_devices"
            assert entry.tenant_id == ctx.tenant_id
            assert entry.user_id == ctx.user_id
            assert entry.user_agent == "mcp"

    @pytest.mark.asyncio
    async def test_a_failing_tool_is_audited_and_still_raises(self):
        """A read that blew up is a read that was attempted; the log must say so,
        and swallowing the error to protect the log would be worse than either."""
        from app.mcp.audit import audited

        written, fake_get_session = self._capture()
        ctx = ToolContext(uuid4(), uuid4(), "VIEWER")

        async def boom(ctx):
            raise ValueError("no such device")

        wrapped = audited("get_device", boom)
        with patch("app.mcp.audit.get_session", new=fake_get_session):
            with pytest.raises(ValueError):
                await wrapped(ctx)

        assert len(written) == 1
        assert written[0].changes["error"].startswith("ValueError")
        assert written[0].changes["result"] is None

    @pytest.mark.asyncio
    async def test_the_result_payload_is_never_copied_into_the_log(self):
        """Only the shape. Copying telemetry bodies would turn audit_logs into a
        second, unmanaged copy of the fleet's data."""
        from app.mcp.audit import audited

        written, fake_get_session = self._capture()
        ctx = ToolContext(uuid4(), uuid4(), "TENANT_ADMIN")

        async def tool(ctx):
            return {"items": [{"secret_reading": 42.0} for _ in range(7)]}

        with patch("app.mcp.audit.get_session", new=fake_get_session):
            await audited("get_device_telemetry", tool)(ctx)

        recorded = written[0].changes["result"]
        assert recorded == {"kind": "items", "count": 7}
        assert "secret_reading" not in str(written[0].changes)

    @pytest.mark.asyncio
    async def test_an_audit_failure_never_fails_the_call(self):
        """An agent read that succeeded but could not be logged still happened.
        Losing the result to protect the log hides it entirely."""
        from app.mcp.audit import audited

        ctx = ToolContext(uuid4(), uuid4(), "TENANT_ADMIN")

        async def tool(ctx):
            return {"items": []}

        def exploding_session():
            raise RuntimeError("database is down")

        with patch("app.mcp.audit.get_session", new=exploding_session):
            assert await audited("get_fleet_health", tool)(ctx) == {"items": []}
