"""Billing — read-only endpoints (step 3).

Public pricing plus a tenant's own subscription / entitlements / usage. No
enforcement here — that's the dependency layer (step 4). Reads are explicitly
tenant-scoped (RLS is inert for the app's DB role).
"""

import secrets
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import text

from app.config import get_settings
from app.database import get_session, RLSSession
from app.dependencies import get_current_tenant, get_current_user_info, get_management_tenant
from app.services import entitlements as ent_service
from app.services import usage as usage_service
from app.services import subscriptions as sub_service
from app.services import billing_ops
from app.services.payments import get_provider, ProviderNotSupported, ProviderError
from app.services.tenant_access import validate_tenant_access

# Public — no auth (the marketing pricing page reads this).
public_router = APIRouter(prefix="/plans", tags=["billing"])

# Tenant-scoped — authenticated.
router = APIRouter(prefix="/tenants/{tenant_id}", tags=["billing"])

# Management-only admin surface (invoiced/enterprise plan assignment).
admin_router = APIRouter(prefix="/admin/tenants/{tenant_id}", tags=["billing-admin"])

# Provider webhooks — public (no JWT); authenticated by signature instead.
webhook_router = APIRouter(prefix="/billing", tags=["billing-webhooks"])


class TrialRequest(BaseModel):
    plan_code: str


class PlanChangeRequest(BaseModel):
    plan_code: str
    billing_interval: str = "month"


class CheckoutRequest(BaseModel):
    plan_code: str
    billing_interval: str = "month"


class ConfirmRequest(BaseModel):
    reference: str


def _require_tenant_admin(tenant_id: UUID, info: dict) -> str:
    """Own-tenant + TENANT_ADMIN/SUPER_ADMIN gate. Returns an actor string for the event log."""
    if str(tenant_id) != str(info["tenant_id"]):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    if info.get("role") not in ("TENANT_ADMIN", "SUPER_ADMIN"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return f"user:{info['user_id']}"


@public_router.get("")
async def list_plans(session: Annotated[RLSSession, Depends(get_session)]):
    """Public catalogue: active public plans with their ZAR prices and feature matrix."""
    plans = (
        (
            await session.execute(
                text(
                    "SELECT id, code, name, description, trial_days, sort_order "
                    "FROM plans WHERE is_public = true AND is_active = true ORDER BY sort_order"
                )
            )
        )
        .mappings()
        .all()
    )

    if not plans:
        return {"plans": []}

    plan_ids = [str(p["id"]) for p in plans]

    prices = (
        (
            await session.execute(
                text(
                    "SELECT plan_id, currency, billing_interval, amount_cents "
                    "FROM plan_prices WHERE plan_id = ANY(:ids) AND is_active = true"
                ),
                {"ids": plan_ids},
            )
        )
        .mappings()
        .all()
    )

    features = (
        (
            await session.execute(
                text(
                    "SELECT pf.plan_id, pf.feature_key, pf.value, f.name, f.kind, f.unit "
                    "FROM plan_features pf JOIN features f ON f.key = pf.feature_key "
                    "WHERE pf.plan_id = ANY(:ids)"
                ),
                {"ids": plan_ids},
            )
        )
        .mappings()
        .all()
    )

    prices_by_plan: dict[str, list] = {}
    for pr in prices:
        prices_by_plan.setdefault(str(pr["plan_id"]), []).append(
            {
                "currency": pr["currency"],
                "interval": pr["billing_interval"],
                "amount_cents": pr["amount_cents"],
            }
        )

    features_by_plan: dict[str, dict] = {}
    for f in features:
        features_by_plan.setdefault(str(f["plan_id"]), {})[f["feature_key"]] = {
            "value": ent_service._coerce(f["value"]),
            "name": f["name"],
            "kind": f["kind"],
            "unit": f["unit"],
        }

    return {
        "plans": [
            {
                "code": p["code"],
                "name": p["name"],
                "description": p["description"],
                "trial_days": p["trial_days"],
                "prices": prices_by_plan.get(str(p["id"]), []),
                "features": features_by_plan.get(str(p["id"]), {}),
            }
            for p in plans
        ]
    }


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

    row = (
        (
            await session.execute(
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
            )
        )
        .mappings()
        .first()
    )

    if row is None:
        return {
            "plan_code": "free",
            "plan_name": "Free",
            "status": "none",
            "provider": None,
            "billing_interval": None,
            "currency": None,
            "trial_ends_at": None,
            "current_period_start": None,
            "current_period_end": None,
            "grace_until": None,
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
        items.append(
            {
                "metric": feature_key,
                "used": used,
                "limit": limit,
                "unlimited": limit is None,
                "remaining": None if limit is None else max(0, limit - used),
            }
        )

    items.sort(key=lambda i: i["metric"])
    return {"plan_code": ent.plan_code, "status": ent.status, "usage": items}


# ── Subscription lifecycle (tenant-admin) ─────────────────────────────────────
# All mutations route through app.services.subscriptions — the sole write path.


@router.post("/subscription/trial")
async def start_trial(
    tenant_id: UUID,
    body: TrialRequest,
    request: Request,
    session: Annotated[RLSSession, Depends(get_session)],
    info: Annotated[dict, Depends(get_current_user_info)],
):
    """Start a free trial on a plan (one per tenant)."""
    actor = _require_tenant_admin(tenant_id, info)
    await session.set_tenant_context(tenant_id)
    redis = getattr(request.app.state, "redis", None)
    return await sub_service.start_trial(
        session,
        redis,
        tenant_id,
        plan_code=body.plan_code,
        actor=actor,
    )


@router.post("/subscription/change")
async def change_plan(
    tenant_id: UUID,
    body: PlanChangeRequest,
    request: Request,
    session: Annotated[RLSSession, Depends(get_session)],
    info: Annotated[dict, Depends(get_current_user_info)],
):
    """Upgrade or downgrade to another plan."""
    actor = _require_tenant_admin(tenant_id, info)
    await session.set_tenant_context(tenant_id)
    redis = getattr(request.app.state, "redis", None)
    return await sub_service.change_plan(
        session, redis, tenant_id, plan_code=body.plan_code, actor=actor
    )


@router.post("/subscription/cancel")
async def cancel_subscription(
    tenant_id: UUID,
    request: Request,
    session: Annotated[RLSSession, Depends(get_session)],
    info: Annotated[dict, Depends(get_current_user_info)],
):
    """Schedule cancellation at the end of the current period."""
    actor = _require_tenant_admin(tenant_id, info)
    await session.set_tenant_context(tenant_id)
    redis = getattr(request.app.state, "redis", None)
    return await sub_service.cancel(session, redis, tenant_id, actor=actor)


@router.post("/subscription/resume")
async def resume_subscription(
    tenant_id: UUID,
    request: Request,
    session: Annotated[RLSSession, Depends(get_session)],
    info: Annotated[dict, Depends(get_current_user_info)],
):
    """Undo a scheduled cancellation."""
    actor = _require_tenant_admin(tenant_id, info)
    await session.set_tenant_context(tenant_id)
    redis = getattr(request.app.state, "redis", None)
    return await sub_service.resume(session, redis, tenant_id, actor=actor)


@router.post("/subscription/checkout")
async def create_checkout(
    tenant_id: UUID,
    body: CheckoutRequest,
    request: Request,
    session: Annotated[RLSSession, Depends(get_session)],
    info: Annotated[dict, Depends(get_current_user_info)],
):
    """Start a card checkout for a paid plan. Returns a redirect_url to Peach's
    hosted page; on successful payment the webhook activates the subscription."""
    _require_tenant_admin(tenant_id, info)
    settings = get_settings()
    if not settings.card_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Card payments are not configured yet",
        )
    await session.set_tenant_context(tenant_id)

    subtotal = await billing_ops._plan_price_cents(
        session, body.plan_code, body.billing_interval, "ZAR"
    )
    if not subtotal:  # free plan or no price → no checkout needed
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This plan has no card price (free, or contact sales)",
        )
    _, total_cents = billing_ops._vat_split(subtotal)  # customer pays VAT-inclusive

    redis = getattr(request.app.state, "redis", None)
    ref = secrets.token_hex(6)  # 12 chars — safe across gateways' reference limits
    await billing_ops.stash_checkout(
        redis, ref, tenant_id=tenant_id, plan_code=body.plan_code, interval=body.billing_interval
    )

    base = str(request.base_url).rstrip("/")
    provider = get_provider(settings.CARD_PROVIDER)
    email = await billing_ops._tenant_billing_email(session, tenant_id)
    try:
        result = await provider.create_checkout(
            amount_cents=total_cents,
            currency="ZAR",
            reference=ref,
            email=email,
            return_url=f"{base}/dashboard/billing?checkout=done",
            notify_url=f"{base}/api/v1/billing/webhooks/{settings.CARD_PROVIDER}",
        )
    except ProviderError as e:
        # Gateway reached but rejected the request (e.g. invalid billing email) —
        # surface its reason, don't let it become an opaque 500.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Payment gateway rejected the request: {e}",
        )
    return {"redirect_url": result.redirect_url, "reference": ref}


@router.post("/subscription/checkout/confirm")
async def confirm_checkout(
    tenant_id: UUID,
    body: ConfirmRequest,
    request: Request,
    session: Annotated[RLSSession, Depends(get_session)],
    info: Annotated[dict, Depends(get_current_user_info)],
):
    """Called when the shopper returns from the hosted checkout. Re-verifies the
    transaction with the gateway server-side (never trusts the browser) and, on a
    confirmed payment, activates the subscription — sharing the webhook's idempotent
    path, so this and a later webhook can't both activate. Works on an internal-only
    server the gateway can't reach with a webhook."""
    _require_tenant_admin(tenant_id, info)
    await session.set_tenant_context(tenant_id)
    settings = get_settings()
    redis = getattr(request.app.state, "redis", None)
    return await billing_ops.confirm_checkout(
        session, redis, settings.CARD_PROVIDER, body.reference
    )


# ── Provider webhooks (public, signature-authenticated) ───────────────────────


@webhook_router.post("/webhooks/{provider}")
async def provider_webhook(
    provider: str,
    request: Request,
    session: Annotated[RLSSession, Depends(get_session)],
):
    """Receive a payment-provider webhook. No JWT — verified by signature inside
    process_webhook (idempotent). Always 200 on a handled event so the provider
    doesn't retry; 400 only on a bad signature."""
    raw = await request.body()
    redis = getattr(request.app.state, "redis", None)
    try:
        result = await billing_ops.process_webhook(
            session, redis, provider, dict(request.headers), raw
        )
    except ProviderNotSupported as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    if not result.get("ok"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=result.get("status"))
    return result


# ── Admin/manual assignment (management tenant only) ──────────────────────────


@admin_router.post("/subscription")
async def admin_assign_plan(
    tenant_id: UUID,
    body: PlanChangeRequest,
    request: Request,
    session: Annotated[RLSSession, Depends(get_session)],
    mgmt: Annotated[tuple[UUID, UUID], Depends(get_management_tenant)],
):
    """Place a tenant on a plan (invoiced/EFT enterprise path). Management tenants only,
    and only for tenants at or below them in the hierarchy."""
    mgmt_tenant_id, mgmt_user_id = mgmt
    if not await validate_tenant_access(session, mgmt_tenant_id, tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Tenant not managed by you"
        )
    await session.set_tenant_context(tenant_id)
    redis = getattr(request.app.state, "redis", None)
    return await sub_service.assign_plan(
        session,
        redis,
        tenant_id,
        plan_code=body.plan_code,
        billing_interval=body.billing_interval,
        actor=f"mgmt:{mgmt_user_id}",
    )
