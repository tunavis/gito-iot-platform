"""MCP server construction, protocol pinning, and mounting.

Mounted **inside** the existing FastAPI app at `/mcp` rather than run as its own
service: it authenticates with the same JWT the REST API already uses, reads
through the same services, and writes the same `AuditLog` rows. A separate
process would need its own copy of all three.
"""

from __future__ import annotations

import logging

from mcp.server.mcpserver import MCPServer
from mcp.types import LATEST_PROTOCOL_VERSION

from app.config import get_settings

logger = logging.getLogger(__name__)

SERVER_NAME = "gito-iot"


class ProtocolVersionMismatch(RuntimeError):
    """Raised at startup when the pinned protocol version is not what the SDK speaks."""


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


def build_mcp_server() -> MCPServer:
    """Construct the MCP server with every tool registered.

    Tools are registered by `app.mcp.tools.register_all`, which routes each one
    through the audit wrapper and the no-tenant-parameter guard at registration
    time, so a tool cannot be added that skips either.
    """
    settings = get_settings()

    server = MCPServer(
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

    # Returns the count rather than reading it back off the server: the SDK's
    # tool registry is private, and reaching into it would break on a bump.
    registered = register_all(server)
    logger.info("mcp_server_built", extra={"tool_count": registered})
    return server
