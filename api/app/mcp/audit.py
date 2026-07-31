"""Audit every MCP tool call, by construction.

The wrapper is applied at registration time in `app.mcp.tools`, not by each tool
author. That is the whole point: a tool added in a hurry six months from now is
audited because it went through the registrar, not because someone remembered.

What gets written and what deliberately does not:

- **Written**: who called, which tool, what arguments, and the *shape* of the
  result — a row count, or the error.
- **Not written**: the result payload. Telemetry and alarm bodies are large and
  can carry customer data; copying them into `audit_logs` would turn the audit
  trail into a second, unmanaged copy of the fleet's data. The shape is what
  answers "what did the agent see" for governance purposes.

Audit failure never fails the call. An agent read that succeeded but whose audit
row could not be written is still a read that happened — swallowing the result
would hide it entirely, which is worse than a gap in the log that is itself
logged loudly.
"""

from __future__ import annotations

import logging
from typing import Any, Callable
from uuid import UUID

from app.database import get_session
from app.mcp.auth import ToolContext
from app.models.base import AuditLog

logger = logging.getLogger(__name__)

# Argument names whose values must never be copied into the audit row verbatim.
# None exist on today's tools, but a future tool taking a token or secret would
# otherwise write it to a table a tenant admin can read in the UI.
REDACTED_ARG_NAMES = frozenset({"token", "password", "secret", "api_key", "authorization"})


def _safe_args(arguments: dict[str, Any]) -> dict[str, Any]:
    """Arguments with anything sensitive replaced, and values kept small."""
    out: dict[str, Any] = {}
    for key, value in (arguments or {}).items():
        if key.lower() in REDACTED_ARG_NAMES:
            out[key] = "[redacted]"
        elif isinstance(value, (str, int, float, bool)) or value is None:
            # Cap strings: an argument is normally a uuid or a metric name, and a
            # pathological one must not bloat every audit row.
            out[key] = (
                value if not isinstance(value, str) or len(value) <= 200 else value[:200] + "…"
            )
        else:
            out[key] = repr(value)[:200]
    return out


def _result_shape(result: Any) -> dict[str, Any]:
    """Describe the result without copying it."""
    if isinstance(result, dict):
        for key in ("items", "devices", "alarms", "rules", "assets", "readings"):
            if isinstance(result.get(key), list):
                return {"kind": key, "count": len(result[key])}
        return {"kind": "object", "keys": sorted(result.keys())[:15]}
    if isinstance(result, list):
        return {"kind": "list", "count": len(result)}
    return {"kind": type(result).__name__}


async def record_tool_call(
    ctx: ToolContext,
    tool_name: str,
    arguments: dict[str, Any],
    *,
    result: Any = None,
    error: str | None = None,
    resource_type: str | None = None,
    resource_id: UUID | None = None,
) -> None:
    """Write one AuditLog row for a tool call.

    Uses its own session rather than the tool's: the tool's session may already be
    rolled back by the failure we are trying to record.
    """
    session_gen = None
    try:
        # Same idiom background_tasks.py uses to get a session outside a request.
        session_gen = get_session()
        session = await session_gen.__anext__()
        try:
            entry = AuditLog(
                tenant_id=ctx.tenant_id,
                user_id=ctx.user_id,
                # `mcp.tool.<name>` so an admin can tell at a glance that an agent
                # did this rather than a human clicking in the UI.
                action=f"mcp.tool.{tool_name}",
                resource_type=resource_type,
                resource_id=resource_id,
                changes={
                    "arguments": _safe_args(arguments),
                    "result": _result_shape(result) if error is None else None,
                    "error": error,
                    "role": ctx.role,
                },
                user_agent="mcp",
            )
            session.add(entry)
            await session.commit()
        finally:
            await session_gen.aclose()
    except Exception as e:  # noqa: BLE001 - see module docstring
        logger.error(
            "mcp_audit_write_failed",
            extra={"tool": tool_name, "tenant_id": str(ctx.tenant_id), "error": str(e)},
        )


def audited(tool_name: str, fn: Callable) -> Callable:
    """Wrap a tool body so every invocation is audited, success or failure."""

    async def wrapper(ctx: ToolContext, **kwargs: Any) -> Any:
        try:
            result = await fn(ctx, **kwargs)
        except Exception as e:  # noqa: BLE001 - recorded, then re-raised
            await record_tool_call(ctx, tool_name, kwargs, error=f"{type(e).__name__}: {e}")
            raise
        await record_tool_call(ctx, tool_name, kwargs, result=result)
        return result

    wrapper.__name__ = getattr(fn, "__name__", tool_name)
    wrapper.__doc__ = fn.__doc__
    return wrapper
