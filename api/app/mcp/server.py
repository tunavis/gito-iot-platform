"""MCP server construction, protocol pinning, and mounting.

Mounted **inside** the existing FastAPI app at `/mcp` rather than run as its own
service: it authenticates with the same JWT the REST API already uses, reads
through the same services, and writes the same `AuditLog` rows. A separate
process would need its own copy of all three.
"""

from __future__ import annotations

import logging
from typing import Any

from mcp.server.mcpserver import MCPServer
from mcp.types import LATEST_PROTOCOL_VERSION, ListToolsResult

from app.config import get_settings
from app.mcp.auth import MCPAuthError, resolve_context

logger = logging.getLogger(__name__)

SERVER_NAME = "gito-iot"


class ProtocolVersionMismatch(RuntimeError):
    """Raised at startup when the pinned protocol version is not what the SDK speaks."""


class UnregisteredTool(RuntimeError):
    """A tool reached the server without going through `app.mcp.tools.register`.

    Which means it skipped the tenant-parameter guard and the audit wrapper —
    the two things standing between an agent and another tenant's data.
    """


def assert_protocol_version() -> str:
    """Fail the boot if the installed SDK does not speak the pinned version.

    MCP is a protocol boundary with clients we do not control. The SDK will
    happily negotiate whatever it supports, which means a routine dependency bump
    could change wire behaviour with nobody deciding to. Pinning the version in
    settings and asserting it here turns that into a loud startup failure instead
    of a silent behaviour change.

    Returns the pinned version so callers can report it.
    """
    settings = get_settings()
    pinned = settings.MCP_PROTOCOL_VERSION
    if pinned != LATEST_PROTOCOL_VERSION:
        raise ProtocolVersionMismatch(
            f"MCP_PROTOCOL_VERSION is pinned to {pinned!r} but the installed SDK "
            f"speaks {LATEST_PROTOCOL_VERSION!r}. Decide which is correct and update "
            f"the pin deliberately — do not widen it to make this pass."
        )
    return pinned


class TenantScopedMCPServer(MCPServer):
    """An MCPServer that advertises only the tools the caller may actually use.

    Every tool is still refused at call time by its own role check — this is not
    the security boundary, and it must never be mistaken for one. It exists
    because a model shown a tool it will be refused does not simply skip it: it
    plans around it, calls it, and reports a confusing failure to a person who
    asked a reasonable question.

    Overriding a private handler is deliberate. There is no public seam for a
    per-caller tool list; the middleware chain the SDK offers is marked
    provisional and expected to change before v2. If a future SDK renames this
    method the override silently stops applying, so
    `test_list_tools_override_still_hooks_the_sdk` asserts the method still
    exists on the base class — a filter that degrades to a no-op is worse than
    one that fails the boot.
    """

    async def _handle_list_tools(self, ctx: Any, params: Any) -> ListToolsResult:
        result = await super()._handle_list_tools(ctx, params)

        # Same header source `Context.headers` uses for tool calls, so listing
        # and calling can never disagree about who is asking.
        headers = getattr(getattr(ctx, "request", None), "headers", None)
        try:
            caller = await resolve_context(dict(headers) if headers else None)
        except MCPAuthError:
            # Task 2.1: no tool listing before the credential resolves. An
            # anonymous caller learns nothing about this tenant's capabilities.
            return ListToolsResult(tools=[])

        if caller.may_issue_commands:
            return result

        from app.mcp.tools import COMMAND_ROLE_TOOLS

        return ListToolsResult(tools=[t for t in result.tools if t.name not in COMMAND_ROLE_TOOLS])


def build_mcp_server() -> MCPServer:
    """Construct the MCP server with every tool registered.

    Tools are registered by `app.mcp.tools.register_all`, which routes each one
    through the audit wrapper and the no-tenant-parameter guard at registration
    time, so a tool cannot be added that skips either.
    """
    settings = get_settings()

    server = TenantScopedMCPServer(
        name=SERVER_NAME,
        title="Gito IoT",
        version=settings.API_VERSION,
        instructions=(
            "Read-only access to one tenant's IoT fleet: devices, telemetry, "
            "alarms, alert rules, assets, and site hierarchy. The tenant is fixed "
            "by the credential you connected with and cannot be changed by any "
            "argument. Device commands are not executed — requesting one records "
            "an approval for a human to action."
        ),
        # Duplicate registration is a bug here, not a warning: two tools with one
        # name means the wrong one may answer.
        warn_on_duplicate_tools=True,
    )

    from app.mcp.tools import register_all

    registered = register_all(server)

    # Prove nothing reached the server except through `register`.
    #
    # `register` is where the no-tenant-parameter guard and the audit wrapper are
    # applied, but `server.add_tool` is a public SDK method — a tool added with
    # it would be advertised to models, would take whatever arguments it liked
    # including a tenant id, and would write no audit row. Nothing about it would
    # look wrong in review; it would simply be a tool, sitting next to the others.
    #
    # RLS is inert under this app's database role, so `register` is not a
    # formality, it is the isolation boundary. Comparing the advertised set
    # against what we registered turns "please always use register()" from a
    # convention someone has to remember into a startup failure.
    advertised = {tool.name for tool in server._tool_manager.list_tools()}  # noqa: SLF001
    unregistered = advertised - registered
    if unregistered:
        raise UnregisteredTool(
            f"MCP tools {sorted(unregistered)} are advertised but did not go through "
            f"app.mcp.tools.register(). They therefore skip the tenant-parameter guard "
            f"and the audit wrapper. Register them properly rather than relaxing this "
            f"check — tenancy here rests on the tool surface, not on RLS."
        )

    logger.info("mcp_server_built", extra={"tool_count": len(registered)})
    return server
