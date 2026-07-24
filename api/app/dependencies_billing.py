"""Billing enforcement — FastAPI dependencies that gate on plan entitlements.

This is the ONLY place entitlement checks live. Routers add a dependency; they
never write `if plan == ...` inline (the mistake the role checks made — see the
scattered `role not in [...]` in users.py). Add one line to a route:

    @router.post("", dependencies=[Depends(enforce_limit("devices.max"))])

`enforce_limit` blocks creating past a numeric cap (402 + upgrade payload);
`require_feature` blocks a feature that isn't in the plan (403). Both resolve the
caller's live entitlements (KeyDB-cached) and re-check server-side — the client
is never trusted.

Enforcement posture (plan decision): never blocks reads or ingestion, only new
provisioning. Existing tenants are grandfathered onto an unlimited legacy plan
(migration 025), so limits only bite new growth.
"""

from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status

from app.database import get_session, RLSSession
from app.dependencies import get_current_tenant
from app.services import entitlements as ent_service
from app.services import usage as usage_service


def _tenant_guard(tenant_id: UUID, current_tenant: UUID) -> None:
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")


def enforce_limit(feature_key: str):
    """Dependency: 402 if creating one more would exceed the plan's numeric limit.

    Checks `used >= limit` (about to create the (limit+1)th). Unlimited (None)
    always passes. Applied to CREATE routes only — never reads.
    """
    async def _dep(
        tenant_id: UUID,
        request: Request,
        session: Annotated[RLSSession, Depends(get_session)],
        current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
    ) -> None:
        _tenant_guard(tenant_id, current_tenant)
        await session.set_tenant_context(tenant_id)
        redis = getattr(request.app.state, "redis", None)

        ent = await ent_service.resolve(session, tenant_id, redis=redis)
        limit = ent.limit(feature_key)
        if limit is None:
            return  # unlimited — nothing to enforce

        used = await usage_service.current(session, tenant_id, feature_key)
        if used >= limit:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={
                    "error": "plan_limit_reached",
                    "feature": feature_key,
                    "plan": ent.plan_code,
                    "limit": limit,
                    "used": used,
                    "message": (
                        f"Your plan allows {limit} for {feature_key} and you're using "
                        f"{used}. Upgrade your plan to add more."
                    ),
                },
            )

    return _dep


def require_feature(feature_key: str):
    """Dependency: 403 if the plan doesn't grant this boolean feature."""
    async def _dep(
        tenant_id: UUID,
        request: Request,
        session: Annotated[RLSSession, Depends(get_session)],
        current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
    ) -> None:
        _tenant_guard(tenant_id, current_tenant)
        await session.set_tenant_context(tenant_id)
        redis = getattr(request.app.state, "redis", None)

        ent = await ent_service.resolve(session, tenant_id, redis=redis)
        if not ent.allows(feature_key):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error": "feature_not_in_plan",
                    "feature": feature_key,
                    "plan": ent.plan_code,
                    "message": f"{feature_key} is not available on your plan. Upgrade to enable it.",
                },
            )

    return _dep
