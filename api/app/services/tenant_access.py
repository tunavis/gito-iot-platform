"""Tenant access validation — supports parent tenant viewing child tenant data.

The core multi-tenancy security helper. Replaces strict equality checks
across all routers with ancestry-aware validation.

Design principles:
- Fast path for same-tenant (no DB query)
- Uses is_ancestor_tenant() SQL function for hierarchy checks
- NEVER modifies the session or RLS context — only validates
"""

from uuid import UUID

from sqlalchemy import text

from app.database import RLSSession


async def validate_tenant_access(
    session: RLSSession,
    current_tenant_id: UUID,
    target_tenant_id: UUID,
) -> bool:
    """
    Return True if current_tenant_id is allowed to access target_tenant_id.

    Allowed when:
    - Same tenant (fast path, no DB query)
    - current_tenant is an ancestor (parent/grandparent/...) of target_tenant

    Args:
        session: Active database session (used only for ancestry query)
        current_tenant_id: The tenant from the JWT (who is making the request)
        target_tenant_id: The tenant in the URL path (whose data is requested)

    Returns:
        True if access is permitted, False otherwise
    """
    # Fast path: same tenant — no DB query needed
    if current_tenant_id == target_tenant_id:
        return True

    # Ancestry check via recursive SQL function (see migration 009)
    result = await session.execute(
        text("SELECT is_ancestor_tenant(:ancestor, :descendant)"),
        {"ancestor": str(current_tenant_id), "descendant": str(target_tenant_id)},
    )
    return result.scalar() is True
