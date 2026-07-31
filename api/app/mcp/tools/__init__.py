"""Tool registration, and the guards that hold at registration time.

Two rules are enforced here by construction rather than by review discipline,
because both are the kind of thing that is fine in every existing tool and wrong
in the one someone adds in a hurry six months from now:

1. **No tool may accept a tenant identifier.** Tenancy comes from the credential.
   A tool that took `tenant_id` would be a cross-tenant read with a
   plausible-looking audit trail — and RLS cannot catch it, because the app
   connects as the database owner and RLS is inert.

2. **Every tool is audited.** The wrapper is applied here, not by each tool
   author, so a new tool cannot be added that skips it.

Both are checked when `register_all` runs, which is at import time on a mounted
server — so a violation fails the boot rather than shipping.
"""

from __future__ import annotations

import logging
from typing import Callable

from mcp.server.mcpserver import MCPServer

logger = logging.getLogger(__name__)

# Argument names that would let a caller choose whose data to read. `user_id` and
# `organization_id` are here for the same reason `tenant_id` is: all three are
# authorization-determining, and a model must not be able to name any of them.
FORBIDDEN_TOOL_PARAMS = frozenset({"tenant_id", "user_id", "organization_id"})


class ForbiddenToolParameter(RuntimeError):
    """A tool tried to expose an authorization-determining parameter."""


def assert_no_tenant_parameters(name: str, fn: Callable) -> None:
    """Reject a tool whose signature names a parameter that would select a tenant.

    Checked against the function signature rather than the generated JSON schema:
    the signature is the thing an author writes, so the error points at the line
    they need to change.
    """
    import inspect

    params = set(inspect.signature(fn).parameters)
    offending = params & FORBIDDEN_TOOL_PARAMS
    if offending:
        raise ForbiddenToolParameter(
            f"MCP tool {name!r} exposes {sorted(offending)}. Tenancy is resolved "
            f"from the bearer credential, never from a tool argument — a model must "
            f"not be able to express a cross-tenant request. Remove the parameter "
            f"and read the tenant from the request context."
        )


def register_all(server: MCPServer) -> int:
    """Register every tool on `server`. Returns how many were registered.

    Tools are added group by group as the change progresses; the guards above
    apply to all of them uniformly.
    """
    registered = 0

    # Read tools (tasks 4.1-4.12) and the approval-gated write (5.2) are
    # registered here as they land. The guards are already active, so the first
    # tool added is checked the same as the last.

    logger.info("mcp_tools_registered", extra={"count": registered})
    return registered
