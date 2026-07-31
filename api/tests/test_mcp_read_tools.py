"""The read tools, checked without a database.

The tenant-isolation suite (task 6.1) needs live data and lives separately. What
is provable here is the part that would otherwise fail silently in production:
that every tool is actually advertised, that none of them can reach a session
except through the guarded helper, and that `call_route` resolves a router's
`Query()` defaults instead of handing a tool the marker object.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

import pytest
from fastapi import Query

from app.mcp.shape import call_route, capped, clamp
from app.mcp.tools.read import READ_TOOLS


class TestCatalogue:
    def test_every_read_tool_is_advertised(self):
        from app.mcp.server import build_mcp_server

        server = build_mcp_server()
        advertised = {t.name for t in server._tool_manager.list_tools()}
        expected = {name for name, _, _ in READ_TOOLS}
        assert expected <= advertised, f"not registered: {sorted(expected - advertised)}"

    def test_descriptions_tell_a_model_what_the_tool_does_not_cover(self):
        """A description is the only thing standing between a model and a
        confident wrong answer about a tool's scope, so it may not be a stub."""
        for name, _, description in READ_TOOLS:
            assert len(description) > 80, f"{name} has a stub description"

    def test_arguments_are_advertised(self):
        """The filters exist to keep an agent from pulling the whole fleet."""
        from app.mcp.server import build_mcp_server

        server = build_mcp_server()
        props = (server._tool_manager.get_tool("list_devices").parameters or {}).get("properties")
        assert {"site_id", "device_group_id", "device_type", "status", "limit"} <= set(props)


class TestSessionsAreGuarded:
    def test_read_module_cannot_open_an_unguarded_session(self):
        """Task 2.4, enforced by absence rather than by inspection of each body.

        `tool_session` applies the tenant guard and the RLS context. If this
        module could import `get_session` directly, a tool could quietly skip
        both — so the check is that the unguarded door is not in the room.
        """
        from app.mcp.tools import read

        assert not hasattr(read, "get_session")
        assert not hasattr(read, "_SessionLocal")


class TestCallRoute:
    @pytest.mark.asyncio
    async def test_query_defaults_are_resolved_not_passed_through(self):
        """Without this, `page` would arrive as a Query object and `(page-1)`
        would raise — the exact failure that appears the day a router grows a
        parameter no tool passes."""

        async def route(a: int, page: int = Query(1, ge=1), name: str | None = Query(None)):
            return {"a": a, "page": page, "name": name}

        assert await call_route(route, a=5) == {"a": 5, "page": 1, "name": None}
        assert (await call_route(route, a=5, page=3))["page"] == 3

    @pytest.mark.asyncio
    async def test_a_required_parameter_the_tool_forgot_fails_loudly(self):
        async def route(start_time: str = Query(...)):
            return start_time

        with pytest.raises(TypeError, match="start_time"):
            await call_route(route)


class TestCapping:
    def test_truncation_is_stated(self):
        """Task 4.11. A silent prefix is how an agent reports a wrong fleet count."""
        out = capped([1, 2, 3], limit=3, total=213)
        assert out["showing"] == 3
        assert out["total"] == 213
        assert "3 of 213" in out["truncated"]

    def test_a_complete_result_is_not_labelled_truncated(self):
        out = capped([1, 2, 3], limit=50, total=3)
        assert "truncated" not in out
        assert out["showing"] == out["total"] == 3

    def test_limit_actually_cuts(self):
        out = capped(list(range(10)), limit=4, total=10)
        assert out["items"] == [0, 1, 2, 3]
        assert "4 of 10" in out["truncated"]

    def test_clamp_bounds_a_model_supplied_number(self):
        assert clamp(0, 1, 100) == 1
        assert clamp(5000, 1, 100) == 100
        assert clamp(50, 1, 100) == 50
