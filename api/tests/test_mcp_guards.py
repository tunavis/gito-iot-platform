"""The MCP registration guards, proven to actually fire.

These are the tests that matter most in the MCP change. RLS is inert under the
app's database role, so tenant isolation rests entirely on tools being unable to
name a tenant. A guard that silently fails to trigger looks exactly like a guard
that is working.

So each test here registers a *deliberately bad* tool and asserts the registrar
refuses it — rather than only checking that the good tools pass.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

from uuid import uuid4

import pytest
from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations

from app.mcp.auth import ToolContext
from app.mcp.tools import (
    FORBIDDEN_TOOL_PARAMS,
    ForbiddenToolParameter,
    assert_schema_has_no_tenant,
    register,
)


READ_ONLY = ToolAnnotations(read_only_hint=True, destructive_hint=False)


def _server() -> MCPServer:
    return MCPServer(name="test-server")


async def _ok_tool(ctx: ToolContext, device_id: str) -> dict:
    """A well-behaved tool: takes no tenant, reads it from ctx."""
    return {"devices": [], "tenant": str(ctx.tenant_id), "device_id": device_id}


class TestTenantParameterGuard:
    @pytest.mark.parametrize("bad_param", sorted(FORBIDDEN_TOOL_PARAMS))
    def test_every_forbidden_parameter_is_refused(self, bad_param):
        """Each of tenant_id/user_id/organization_id must be refused by name."""
        ns: dict = {}
        exec(
            f"async def bad_tool(ctx, {bad_param}: str) -> dict:\n    return {{}}\n",
            {"ToolContext": ToolContext},
            ns,
        )
        with pytest.raises(ForbiddenToolParameter) as exc:
            register(
                _server(), "bad_tool", ns["bad_tool"], description="bad", annotations=READ_ONLY
            )
        assert bad_param in str(exc.value)

    def test_good_tool_registers(self):
        server = _server()
        register(server, "list_devices", _ok_tool, description="fine", annotations=READ_ONLY)
        assert server._tool_manager.get_tool("list_devices") is not None

    def test_ctx_is_not_treated_as_a_caller_parameter(self):
        """`ctx` is injected, so it must not be flagged or advertised."""
        server = _server()
        register(server, "ok", _ok_tool, description="fine", annotations=READ_ONLY)
        tool = server._tool_manager.get_tool("ok")
        props = (tool.parameters or {}).get("properties") or {}
        assert "ctx" not in props
        assert "context" not in props
        assert "device_id" in props, "real arguments must still be advertised"


class TestSchemaGuard:
    def test_schema_containing_a_tenant_is_refused(self):
        """The second guard, checked against the advertised schema directly.

        This is the one that still holds if a parameter reaches the schema by a
        route the signature check cannot see.
        """
        with pytest.raises(ForbiddenToolParameter):
            assert_schema_has_no_tenant("sneaky", {"properties": {"tenant_id": {"type": "string"}}})

    def test_clean_schema_passes(self):
        assert_schema_has_no_tenant("clean", {"properties": {"device_id": {"type": "string"}}})

    def test_empty_schema_passes(self):
        assert_schema_has_no_tenant("empty", {})
        assert_schema_has_no_tenant("none", None)


class TestRegisteredToolsAreClean:
    def test_no_registered_tool_advertises_a_tenant(self):
        """Task 6.2 — over the real server, whatever is registered at the time.

        Written to pass with zero tools and keep passing as tools land, so it
        guards the tools added after this test was written, not just today's.
        """
        from app.mcp.server import build_mcp_server

        server = build_mcp_server()
        for tool in server._tool_manager.list_tools():
            props = (tool.parameters or {}).get("properties") or {}
            offending = set(props) & FORBIDDEN_TOOL_PARAMS
            assert not offending, f"{tool.name} advertises {sorted(offending)}"


class TestNoToolBypassesTheRegistrar:
    """`register` is the isolation boundary, so reaching the server another way
    must fail the boot rather than quietly working."""

    def test_a_tool_added_directly_fails_the_build(self):
        """`server.add_tool` is a public SDK method. A tool added with it takes
        whatever arguments it likes — including a tenant id — and writes no audit
        row, and nothing about it looks wrong in review."""
        import app.mcp.tools as tools_module
        from app.mcp.server import UnregisteredTool, build_mcp_server

        real_register_all = tools_module.register_all

        def sneaky_register_all(server):
            registered = real_register_all(server)

            async def smuggled(context, tenant_id: str) -> dict:
                return {"devices": ["someone else's"]}

            server.add_tool(smuggled, name="smuggled", description="bypasses register()")
            return registered

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(tools_module, "register_all", sneaky_register_all)
            with pytest.raises(UnregisteredTool) as exc:
                build_mcp_server()

        assert "smuggled" in str(exc.value)

    def test_a_tool_must_declare_whether_it_is_destructive(self):
        """Task 5.5. `annotations` has no default, so omitting it is a TypeError
        at registration — which happens during app construction, so a tool that
        never says what it does fails the boot rather than being advertised with
        an effect the registrar guessed on its behalf."""
        with pytest.raises(TypeError, match="annotations"):
            register(_server(), "undeclared", _ok_tool, description="says nothing")

    def test_the_honest_server_builds(self):
        """The guard must not fire on the real tool set — a check that always
        trips gets deleted by whoever hits it next."""
        from app.mcp.server import build_mcp_server

        server = build_mcp_server()
        assert server._tool_manager.list_tools(), "expected tools to be registered"


class TestRoleGate:
    def test_command_role_ladder_matches_platform_rbac(self):
        """VIEWER/CLIENT are read-only in the UI and must stay read-only over MCP."""
        for role in ("SUPER_ADMIN", "TENANT_ADMIN", "SITE_ADMIN"):
            assert ToolContext(uuid4(), uuid4(), role).may_issue_commands, role
        for role in ("VIEWER", "CLIENT", None, "", "nonsense"):
            assert not ToolContext(uuid4(), uuid4(), role).may_issue_commands, role

    def test_role_check_is_case_insensitive(self):
        assert ToolContext(uuid4(), uuid4(), "tenant_admin").may_issue_commands
