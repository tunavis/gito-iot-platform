"""MCP server for the Gito platform.

Everything here is a thin adapter over an existing service or router function.
No module in this package contains its own SQL or a second copy of the
tenant-scoping rules — if a tool needs a query, the query belongs in the service
layer where the REST API already uses it.

The governing rule, enforced in code rather than by review: **no exposed tool
takes a tenant identifier as a parameter.** Tenancy is resolved from the bearer
credential once per session and injected. A model cannot express a cross-tenant
request because the vocabulary is not in the tool schema.
"""

from app.mcp.server import assert_protocol_version, build_mcp_server

__all__ = ["assert_protocol_version", "build_mcp_server"]
