"""Tool registration, and the guards that hold at registration time.

Three rules are enforced here by construction rather than by review discipline,
because each is fine in every existing tool and wrong in the one someone adds in
a hurry six months from now:

1. **No tool may accept a tenant identifier.** Tenancy comes from the credential.
   A tool taking `tenant_id` would be a cross-tenant read with a plausible-looking
   audit trail — and RLS cannot catch it, because the app connects as the database
   owner and RLS is inert in this deployment.

2. **Every tool is audited.** The wrapper is applied here, not by each author, so
   a new tool cannot be added that skips it.

3. **Every tool resolves its caller from the credential** before its body runs,
   and role-restricted tools are not even advertised to roles that may not use
   them — an agent should not see an affordance it will be refused.

All three are applied by `register`, and `register` is the only way a tool gets
onto the server. Violations raise at registration, which happens during app
construction, so a bad tool fails the boot rather than shipping.
"""

from __future__ import annotations

import inspect
import logging
from collections.abc import Callable
from typing import Any, get_type_hints

from fastapi import HTTPException
from mcp.server.mcpserver import Context, MCPServer
from mcp.types import ToolAnnotations

from app.mcp.audit import audited
from app.mcp.auth import MCPAuthError, resolve_context

logger = logging.getLogger(__name__)

# Only the statuses a read path actually produces. Anything else stays "error"
# rather than being given a reassuring name it may not deserve.
_ERROR_KINDS = {403: "forbidden", 404: "not_found", 400: "bad_request", 422: "bad_request"}

# Argument names that would let a caller choose whose data to read. `user_id` and
# `organization_id` are here for the same reason `tenant_id` is: all three are
# authorization-determining, and a model must not be able to name any of them.
FORBIDDEN_TOOL_PARAMS = frozenset({"tenant_id", "user_id", "organization_id"})


class ForbiddenToolParameter(RuntimeError):
    """A tool tried to expose an authorization-determining parameter."""


# Names of tools that only command-issuing roles may see or call. A name
# allowlist rather than per-server state: the names are fixed at import, so a
# test that builds a second server adds nothing new. `TenantScopedMCPServer`
# reads this when answering tools/list.
COMMAND_ROLE_TOOLS: set[str] = set()


def assert_no_tenant_parameters(name: str, fn: Callable) -> None:
    """Reject a tool whose signature names a parameter that would select a tenant.

    Checked against the function signature, which is what an author writes, so the
    error points at the line they need to change. `ctx` is excluded because it is
    injected by the registrar, never supplied by the caller and never present in
    the schema the model sees.
    """
    params = set(inspect.signature(fn).parameters) - {"ctx"}
    offending = params & FORBIDDEN_TOOL_PARAMS
    if offending:
        raise ForbiddenToolParameter(
            f"MCP tool {name!r} exposes {sorted(offending)}. Tenancy is resolved "
            f"from the bearer credential, never from a tool argument — a model must "
            f"not be able to express a cross-tenant request. Remove the parameter "
            f"and read it from the injected ToolContext instead."
        )


def assert_schema_has_no_tenant(name: str, schema: dict[str, Any]) -> None:
    """Second check, against the JSON schema the model actually receives.

    The signature check above is the one that gives a good error message; this one
    is the one that is actually true. A tool could grow a parameter whose schema
    is built some other way — a Pydantic model argument, say — and the signature
    check would not see it. This looks at what is advertised.
    """
    properties = (schema or {}).get("properties") or {}
    offending = set(properties) & FORBIDDEN_TOOL_PARAMS
    if offending:
        raise ForbiddenToolParameter(
            f"MCP tool {name!r} advertises {sorted(offending)} in its input schema. "
            f"Tenancy comes from the credential, never from a tool argument."
        )


def register(
    server: MCPServer,
    name: str,
    fn: Callable,
    *,
    description: str,
    annotations: ToolAnnotations,
    requires_command_role: bool = False,
) -> None:
    """Register one tool with auth resolution, auditing, and the guards applied.

    `fn` is written as `async def fn(ctx: ToolContext, **kwargs)` — it receives an
    already-resolved caller and never sees headers or tokens.

    `annotations` has no default on purpose. It is how a client learns whether a
    tool merely reads or changes something, and a default would silently pick an
    answer for whoever forgot — in the safe direction for a read and the
    dangerous direction for a write. Declaring the effect is part of adding a
    tool, in the same way not naming a tenant is.
    """
    assert_no_tenant_parameters(name, fn)
    if requires_command_role:
        COMMAND_ROLE_TOOLS.add(name)
    body = audited(name, fn)

    # Rebuild the signature without `ctx` so the SDK advertises only the arguments
    # a caller actually supplies. Without this the model would be asked to invent
    # a ToolContext.
    #
    # The annotations are resolved to real types first. Tool modules use `from
    # __future__ import annotations`, so `inspect.signature` hands back strings
    # like "UUID | None"; the SDK evaluates a signature against the *entry
    # function's* globals, which are this module's, where those names do not
    # exist. get_type_hints resolves them where they were written instead.
    original = inspect.signature(fn)
    hints = get_type_hints(fn)
    caller_params = [
        p.replace(annotation=hints.get(n, p.annotation))
        for n, p in original.parameters.items()
        if n != "ctx"
    ]

    async def tool_entry(context: Context, **kwargs: Any) -> Any:
        try:
            ctx = await resolve_context(dict(context.headers or {}))
        except MCPAuthError as e:
            # Returned as a value, not raised: the transport already answered 200,
            # and a clear refusal is more useful to a model than a stack trace.
            return {"error": "unauthenticated", "detail": str(e)}

        if requires_command_role and not ctx.may_issue_commands:
            return {
                "error": "forbidden",
                "detail": (
                    f"Role {ctx.role!r} may not request device commands. This mirrors "
                    f"the platform's existing permissions — MCP grants no authority "
                    f"the same user lacks in the UI."
                ),
            }

        try:
            return await body(ctx, **kwargs)
        except HTTPException as e:
            # The tools wrap router functions, which signal "not found" and
            # "denied" by raising HTTPException. There is no HTTP response to
            # put a status on here, and a traceback tells a model nothing it can
            # act on — so it becomes a refusal it can read. The audit row was
            # already written as an error by `body`, before this catch.
            return {"error": _ERROR_KINDS.get(e.status_code, "error"), "detail": str(e.detail)}

    tool_entry.__name__ = name
    tool_entry.__doc__ = description
    tool_entry.__signature__ = original.replace(
        parameters=[
            inspect.Parameter(
                "context", inspect.Parameter.POSITIONAL_OR_KEYWORD, annotation=Context
            ),
            *caller_params,
        ]
    )

    server.add_tool(tool_entry, name=name, description=description, annotations=annotations)

    # Verify against the schema the SDK will actually advertise.
    #
    # This reaches into `_tool_manager` deliberately. The public `list_tools()` is
    # a coroutine and registration is synchronous, so there is no public sync
    # accessor. An earlier version of this used `server.list_tools()` without
    # awaiting it, which meant the loop never ran and this guard silently checked
    # nothing — the exact failure mode the guard exists to prevent.
    #
    # If a future SDK moves this, the AttributeError is intentional and must not
    # be softened into a skip: a security guard that degrades to a no-op is worse
    # than one that fails the boot.
    registered_tool = server._tool_manager.get_tool(name)  # noqa: SLF001
    if registered_tool is None:
        raise RuntimeError(f"MCP tool {name!r} did not register; cannot verify its schema.")
    assert_schema_has_no_tenant(name, registered_tool.parameters or {})


def register_all(server: MCPServer) -> set[str]:
    """Register every tool on `server`. Returns the names it registered.

    The names are returned, not just a count, so the caller can prove the server
    advertises *exactly* these and nothing else — see `build_mcp_server`.
    """
    from app.mcp.tools.read import READ_TOOLS
    from app.mcp.tools.write import WRITE_TOOLS

    registered: set[str] = set()

    # Read tools (tasks 4.1-4.12). Available to every role, including VIEWER and
    # CLIENT — MCP grants no authority the same user lacks in the UI, and reading
    # is what those roles already do there.
    # Read-only by construction: membership of READ_TOOLS *is* the declaration,
    # so a tool added to this list cannot claim to be a read while writing —
    # it would have to be moved to the other list to get a session that writes.
    for name, fn, description in READ_TOOLS:
        register(
            server,
            name,
            fn,
            description=description,
            annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False),
        )
        registered.add(name)

    # The approval-gated write. Advertised only to roles that may issue commands
    # today, so a VIEWER is not shown an affordance it would be refused — and
    # refused again by the role check in `tool_entry` if it calls it anyway.
    for name, fn, description in WRITE_TOOLS:
        register(
            server,
            name,
            fn,
            description=description,
            # destructive_hint even though the tool dispatches nothing: what it
            # records leads to a device being actuated, and a client deciding how
            # cautiously to present a tool should weigh the consequence, not the
            # immediacy. Calling it read-only because the effect is deferred is
            # the kind of technically-true that gets someone hurt.
            annotations=ToolAnnotations(read_only_hint=False, destructive_hint=True),
            requires_command_role=True,
        )
        registered.add(name)

    logger.info("mcp_tools_registered", extra={"count": len(registered)})
    return registered
