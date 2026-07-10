"""ASGI middleware for cross-cutting concerns.

Audit logging is centralized here rather than instrumented into each of the
19+ routers individually — a router that forgets to add the call silently
never gets audited, and nothing catches that. A path-based middleware can't be
missed by construction: every tenant-scoped mutation gets a row regardless of
which router handled it.
"""

import logging
import re
from uuid import UUID

from starlette.requests import Request

from app.database import _SessionLocal
from app.models.base import AuditLog
from app.security import decode_token

logger = logging.getLogger(__name__)

_ACTION_BY_METHOD = {"POST": "create", "PUT": "update", "PATCH": "update", "DELETE": "delete"}
_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_TENANT_PREFIX_RE = re.compile(r"^/api/v[0-9]+/tenants/([0-9a-fA-F-]{36})/(.+)$")


def _parse_audit_target(path: str) -> tuple[str, str, str | None] | None:
    """Return (tenant_id, resource_type, resource_id) from a tenant-scoped
    request path, or None if the path isn't tenant-scoped.

    resource_type is every path segment between the tenant_id and a trailing
    UUID (if any) — e.g. "/tenants/{tid}/ota/campaigns/{cid}/execute" (no
    trailing UUID, "execute" isn't one) yields resource_type="ota/campaigns/execute"
    with no resource_id; "/tenants/{tid}/devices/{did}" yields
    resource_type="devices", resource_id={did}. Approximate by design — this
    is a best-effort audit trail, not a router-aware parser.
    """
    match = _TENANT_PREFIX_RE.match(path)
    if not match:
        return None
    tenant_id, rest = match.groups()
    segments = [s for s in rest.split("/") if s]
    if not segments:
        return None
    resource_id = segments.pop() if _UUID_RE.match(segments[-1]) else None
    resource_type = "/".join(segments) if segments else None
    if not resource_type:
        return None
    return tenant_id, resource_type, resource_id


async def audit_log_middleware(request: Request, call_next):
    """Write an audit_logs row for successful tenant-scoped mutations.

    Best-effort: any failure here is logged and swallowed — audit logging
    must never be the reason a real request fails.
    """
    response = await call_next(request)

    if request.method not in _ACTION_BY_METHOD or not (200 <= response.status_code < 300):
        return response

    try:
        target = _parse_audit_target(request.url.path)
        if not target:
            return response
        tenant_id, resource_type, resource_id = target

        user_id = None
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            try:
                payload = decode_token(auth_header.split(" ", 1)[1])
                user_id = payload.get("sub")
            except Exception:
                pass  # Expired/invalid token on an already-completed 2xx response shouldn't happen; skip user_id if it does.

        async with _SessionLocal() as session:
            await session.set_tenant_context(tenant_id, user_id)
            session.add(AuditLog(
                tenant_id=UUID(tenant_id),
                user_id=UUID(user_id) if user_id else None,
                action=_ACTION_BY_METHOD[request.method],
                resource_type=resource_type,
                resource_id=UUID(resource_id) if resource_id else None,
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            ))
            await session.commit()
    except Exception as e:
        logger.error(f"Audit log middleware failed for {request.method} {request.url.path}: {e}")

    return response
