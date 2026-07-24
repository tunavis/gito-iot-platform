"""Billing — read-only endpoints (step 3).

Public pricing plus a tenant's own subscription / entitlements / usage. No
enforcement here — that's the dependency layer (step 4). Reads are explicitly
tenant-scoped (RLS is inert for the app's DB role).
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import text

from app.database import get_session, RLSSession
from app.dependencies import get_current_tenant
from app.services import entitlements as ent_service
from app.services import usage as usage_service

# Public — no auth (the marketing pricing page reads this).
public_router = APIRouter(prefix="/plans", tags=["billing"])

# Tenant-scoped — authenticated.
router = APIRouter(prefix="/tenants/{tenant_id}", tags=["billing"])


@public_router.get("")
async def list_plans(session: Annotated[RLSSession, Depends(get_session)]):
    """Public catalogue: active public plans with their ZAR prices and feature matrix."""
    plans = (await session.execute(text(
        "SELECT id, code, name, description, trial_days, sort_order "
        "FROM plans WHERE is_public = true AND is_active = true ORDER BY sort_order"
    ))).mappings().all()

    if not plans:
        return {"plans": []}

    plan_ids = [str(p["id"]) for p in plans]

    prices = (await session.execute(
        text(
            "SELECT plan_id, currency, billing_interval, amount_cents "
            "FROM plan_prices WHERE plan_id = ANY(:ids) AND is_active = true"
        ),
        {"ids": plan_ids},
    )).mappings().all()

    features = (await session.execute(
        text(
            "SELECT pf.plan_id, pf.feature_key, pf.value, f.name, f.kind, f.unit "
            "FROM plan_features pf JOIN features f ON f.key = pf.feature_key "
            "WHERE pf.plan_id = ANY(:ids)"
        ),
        {"ids": plan_ids},
    )).mappings().all()

    prices_by_plan: dict[str, list] = {}
    for pr in prices:
        prices_by_plan.setdefault(str(pr["plan_id"]), []).append({
            "currency": pr["currency"],
            "interval": pr["billing_interval"],
            "amount_cents": pr["amount_cents"],
        })

    features_by_plan: dict[str, dict] = {}
    for f in features:
        features_by_plan.setdefault(str(f["plan_id"]), {})[f["feature_key"]] = {
            "value": ent_service._coerce(f["value"]),
            "name": f["name"],
            "kind": f["kind"],
            "unit": f["unit"],
        }

    return {"plans": [
        {
            "code": p["code"],
            "name": p["name"],
            "description": p["description"],
            "trial_days": p["trial_days"],
            "prices": prices_by_plan.get(str(p["id"]), []),
            "features": features_by_plan.get(str(p["id"]), {}),
        }
        for p in plans
    ]}


def _require_own_tenant(tenant_id: UUID, current_tenant: UUID) -> None:
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")


@router.get("/subscription")
async def get_subscription(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
):
    """The tenant's current subscription (or the implicit free tier if none)."""
    _require_own_tenant(tenant_id, current_tenant)
    await session.set_tenant_context(tenant_id)

    row = (await session.execute(
        text(
            "SELECT s.status, s.provider, s.billing_interval, s.currency, "
            "       s.trial_ends_at, s.current_period_start, s.current_period_end, "
            "       s.grace_until, s.cancel_at_period_end, p.code AS plan_code, p.name AS plan_name "
            "FROM subscriptions s JOIN plans p ON p.id = s.plan_id "
            "WHERE s.tenant_id = :tid "
            "  AND s.status = ANY(:statuses) "
            "ORDER BY s.created_at DESC LIMIT 1"
        ),
        {"tid": str(tenant_id), "statuses": list(ent_service.LIVE_STATUSES)},
    )).mappings().first()

    if row is None:
        return {
            "plan_code": "free", "plan_name": "Free", "status": "none",
            "provider": None, "billing_interval": None, "currency": None,
            "trial_ends_at": None, "current_period_start": None,
            "current_period_end": None, "grace_until": None,
            "cancel_at_period_end": False,
        }
    return dict(row)


@router.get("/entitlements")
async def get_entitlements(
    tenant_id: UUID,
    request: Request,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
):
    """Resolved entitlement matrix — for the UI to gate features (server re-checks anyway)."""
    _require_own_tenant(tenant_id, current_tenant)
    await session.set_tenant_context(tenant_id)
    redis = getattr(request.app.state, "redis", None)
    ent = await ent_service.resolve(session, tenant_id, redis=redis)
    return ent.to_dict()


@router.get("/usage")
async def get_usage(
    tenant_id: UUID,
    request: Request,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
):
    """Current usage vs plan limit for every metered dimension."""
    _require_own_tenant(tenant_id, current_tenant)
    await session.set_tenant_context(tenant_id)
    redis = getattr(request.app.state, "redis", None)
    ent = await ent_service.resolve(session, tenant_id, redis=redis)

    items = []
    for feature_key, value in ent.features.items():
        if not usage_service.is_metered(feature_key):
            continue
        limit = ent.limit(feature_key)  # None = unlimited
        used = await usage_service.current(session, tenant_id, feature_key)
        items.append({
            "metric": feature_key,
            "used": used,
            "limit": limit,
            "unlimited": limit is None,
            "remaining": None if limit is None else max(0, limit - used),
        })

    items.sort(key=lambda i: i["metric"])
    return {"plan_code": ent.plan_code, "status": ent.status, "usage": items}
