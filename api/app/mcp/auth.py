"""Resolve an MCP caller's identity from the bearer credential.

The single rule this file exists to enforce: **tenancy comes from the
credential, never from a tool argument.** Everything else in the MCP package
depends on that being true, so it is resolved once, here, from the same
`Authorization` header and the same `decode_token` the REST API uses.

Re-parsing the JWT independently would be a second implementation of "who is
this", free to drift from `app/dependencies.py` — and a drift in this particular
function is a cross-tenant read.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from fastapi import HTTPException

from app.dependencies import get_current_user_info, may_actuate_device


class MCPAuthError(RuntimeError):
    """Raised when an MCP request carries no usable credential.

    Deliberately not an HTTPException: MCP tool errors travel as JSON-RPC error
    results, not HTTP status codes, and the transport has already returned 200 by
    the time a tool body runs.
    """


@dataclass(frozen=True)
class ToolContext:
    """Who is calling, resolved from the credential.

    Frozen because nothing downstream may adjust the tenant mid-call. A tool that
    could rebind its own tenant would defeat the entire scoping model.
    """

    tenant_id: UUID
    user_id: UUID
    role: str | None

    @property
    def may_issue_commands(self) -> bool:
        """Roles allowed to request a device command.

        Reads the platform's own rule rather than restating it. This used to
        carry its own copy of the role set, which was correct only for as long as
        nobody changed the other one — and the REST command endpoint had no role
        check at all, so the two already disagreed.
        """
        return may_actuate_device(self.role)


def _bearer_from_headers(headers: dict[str, str] | None) -> str | None:
    """Pull the Authorization header, case-insensitively.

    HTTP header names are case-insensitive and the SDK hands them over as a plain
    dict, so matching on the exact string 'authorization' would work in testing
    and fail against a client that sends 'Authorization'.
    """
    if not headers:
        return None
    for key, value in headers.items():
        if key.lower() == "authorization":
            return value
    return None


async def resolve_context(headers: dict[str, str] | None) -> ToolContext:
    """Resolve the caller from request headers, or raise MCPAuthError.

    Called per tool invocation rather than cached on the session: a session can
    outlive the token that opened it, and continuing to serve a caller whose
    credential has since expired is exactly the kind of thing that is invisible
    until it matters.
    """
    authorization = _bearer_from_headers(headers)
    if not authorization:
        raise MCPAuthError(
            "No Authorization header. Connect with a bearer token; the tenant is "
            "taken from it and cannot be supplied as an argument."
        )

    try:
        info = await get_current_user_info(authorization=authorization)
    except HTTPException as e:
        # Translate FastAPI's 401 into the MCP-native failure. The detail is
        # carried through because it distinguishes "no header" from "expired".
        raise MCPAuthError(f"Authentication failed: {e.detail}") from e

    return ToolContext(
        tenant_id=info["tenant_id"],
        user_id=info["user_id"],
        role=info.get("role"),
    )
