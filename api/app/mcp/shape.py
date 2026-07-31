"""Shared plumbing for MCP tool bodies: sessions, route calls, result shaping.

Everything here exists because it must be identical across every tool, and a
per-tool copy would drift:

- `tool_session` is the only way a tool gets a database session, so the tenant
  guard and the RLS context are applied by construction rather than by each
  author remembering (task 2.4).
- `call_route` invokes an existing router function directly. Tools wrap routers
  instead of writing their own SQL, so the answer an agent gets and the answer
  the UI shows come from one query.
- `capped` states truncation in the response. A silent prefix is how an agent
  confidently reports a wrong fleet count.
"""

from __future__ import annotations

import inspect
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Any

from pydantic.fields import FieldInfo
from pydantic_core import PydanticUndefined

from app.database import RLSSession, get_session
from app.mcp.auth import ToolContext
from app.services.tenant_access import validate_tenant_access

# Read tools return whole objects, not rows, so the ceiling is about how much an
# agent can usefully reason over in one turn rather than what the database can
# serve. Anything larger should be narrowed with filters.
DEFAULT_ITEMS = 50
MAX_ITEMS = 100


class ToolAccessError(RuntimeError):
    """The caller's credential does not grant access to its own tenant."""


@asynccontextmanager
async def tool_session(ctx: ToolContext) -> AsyncIterator[RLSSession]:
    """Yield a session already guarded and scoped to the caller's tenant.

    `validate_tenant_access(ctx.tenant_id, ctx.tenant_id)` is a tautology today —
    the tenant is taken from the credential, so target and current are always the
    same value, and the helper's fast path returns True without a query. It is
    still called, deliberately: it is the platform's one answer to "may this
    caller read this tenant", and a tool path that skips it is a tool path that
    would not notice if that answer ever grew a second condition.

    `set_tenant_context` is not a tautology. RLS is inert under the app's
    database role, but the routers below still rely on the setting, and the
    session must look to them exactly as it does inside a request.
    """
    session_gen = get_session()
    session = await session_gen.__anext__()
    try:
        if not await validate_tenant_access(session, ctx.tenant_id, ctx.tenant_id):
            raise ToolAccessError(f"Tenant access denied for {ctx.tenant_id}")
        await session.set_tenant_context(ctx.tenant_id, ctx.user_id)
        yield session
    finally:
        await session_gen.aclose()


async def call_route(fn: Callable, **kwargs: Any) -> Any:
    """Call a FastAPI route function directly, resolving its `Query()` defaults.

    A route parameter that is not passed defaults to the `Query(...)` marker
    object itself, not to the value inside it — FastAPI substitutes the real
    value at request time, and there is no request here. Passing every parameter
    by hand would work until the day a router grows a new one, at which point
    every tool that wraps it would quietly receive a FieldInfo where it expected
    an int.

    **The marker's validators do not run.** `Query(50, ge=1, le=100)` gives this
    function the 50 and nothing else, so a caller-supplied value must be clamped
    by the tool before it gets here. `clamp` is next to this for that reason.
    """
    bound: dict[str, Any] = {}
    for name, param in inspect.signature(fn).parameters.items():
        if name in kwargs:
            bound[name] = kwargs[name]
            continue
        default = param.default
        if isinstance(default, FieldInfo):
            if default.default is PydanticUndefined:
                raise TypeError(
                    f"{fn.__name__}() requires {name!r}, which has no default to fall back on. "
                    f"Pass it explicitly from the tool."
                )
            bound[name] = default.default
        elif default is not inspect.Parameter.empty:
            bound[name] = default
        else:
            raise TypeError(f"{fn.__name__}() requires {name!r}; the tool did not supply it.")
    return await fn(**bound)


def clamp(value: int, low: int, high: int) -> int:
    """Bound a caller-supplied number. See `call_route` for why this is manual."""
    return max(low, min(int(value), high))


def capped(items: list, limit: int, total: int | None = None) -> dict:
    """Wrap a result list so truncation is stated rather than implied.

    `total` is the count the underlying query reported, which is usually larger
    than `len(items)` because the query was already paginated. Reporting it is
    the whole point: "showing 50 of 213" is a different answer from "50".
    """
    shown = items[:limit]
    total = len(items) if total is None else total
    out: dict[str, Any] = {"items": shown, "showing": len(shown), "total": total}
    if len(shown) < total:
        out["truncated"] = (
            f"Showing {len(shown)} of {total}. This is not the whole set — "
            f"narrow the filters, or say so when reporting the result."
        )
    return out
