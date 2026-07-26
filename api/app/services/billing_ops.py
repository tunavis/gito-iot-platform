"""Billing operations — invoices, payments, webhook processing, recurring charges.

Provider-agnostic: everything here works against the normalised PaymentProvider
results, so it is unit-testable without any real gateway. The Peach-specific HTTP
lives only in peach.py.

Flow it implements:
- Checkout success webhook → activate the subscription on its plan (storing the
  card token), issue an invoice, record the payment.
- Recurring renewal (scheduler) → charge the stored token, invoice + record.
- Failed charge → move the subscription to past_due (grace), record the failure.
- Every webhook is idempotent via webhook_events(provider, provider_event_id).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID

from sqlalchemy import text

from app.services import subscriptions as sub_service
from app.services import entitlements as ent_service
from app.services.payments import get_provider, ProviderWebhook

logger = logging.getLogger(__name__)

VAT_RATE = Decimal("0.15")  # South Africa
CHECKOUT_TTL_SECONDS = 3600  # a pending card checkout is valid for 1 hour


def _card_provider() -> str:
    """The active card gateway name (config-driven; 'paystack' by default)."""
    from app.config import get_settings
    return get_settings().CARD_PROVIDER


async def _tenant_billing_email(session, tenant_id) -> str | None:
    """The customer email for the tenant's card gateway. Paystack needs an email on
    both checkout and each recurring charge; the tenant's earliest (owner) user is a
    stable identifier that maps to one gateway customer across renewals."""
    return (await session.execute(
        text("SELECT email FROM users WHERE tenant_id = :tid ORDER BY created_at ASC LIMIT 1"),
        {"tid": str(tenant_id)},
    )).scalar_one_or_none()


def _vat_split(subtotal_cents: int) -> tuple[int, int]:
    """(vat_cents, total_cents) for a VAT-exclusive subtotal. 15%, rounded to the cent."""
    vat = int((Decimal(subtotal_cents) * VAT_RATE).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return vat, subtotal_cents + vat


async def _plan_price_cents(session, plan_code: str, interval: str, currency: str) -> int | None:
    row = (await session.execute(
        text(
            "SELECT pp.amount_cents FROM plan_prices pp JOIN plans p ON p.id = pp.plan_id "
            "WHERE p.code = :code AND pp.billing_interval = :interval AND pp.currency = :cur "
            "AND pp.is_active = true LIMIT 1"
        ),
        {"code": plan_code, "interval": interval, "cur": currency},
    )).scalar_one_or_none()
    return int(row) if row is not None else None


async def _next_invoice_number(session) -> str:
    """INV-YYYY-NNNNNN, sequential within the year.

    ponytail: derived from a count, not a DB sequence — fine at SaaS invoice volume
    (one per tenant per period). invoices.number is UNIQUE, so a concurrent collision
    fails the insert rather than duplicating; swap for a Postgres sequence if that
    ever actually happens.
    """
    year = datetime.utcnow().year
    n = (await session.execute(
        text("SELECT count(*) FROM invoices WHERE number LIKE :pat"),
        {"pat": f"INV-{year}-%"},
    )).scalar_one()
    return f"INV-{year}-{n + 1:06d}"


async def create_invoice(
    session, tenant_id, *, subscription_id, subtotal_cents: int, currency: str,
    provider: str, status: str = "paid", period_start=None, period_end=None,
) -> dict:
    """Create an invoice with 15% VAT. Returns {id, number, total_cents}."""
    vat_cents, total_cents = _vat_split(subtotal_cents)
    number = await _next_invoice_number(session)
    now = datetime.utcnow()
    row = (await session.execute(
        text(
            "INSERT INTO invoices (tenant_id, subscription_id, number, status, currency, "
            " subtotal_cents, vat_cents, total_cents, provider, period_start, period_end, "
            " issued_at, paid_at) "
            "VALUES (:tid, :sid, :num, :status, :cur, :sub, :vat, :tot, :prov, :ps, :pe, :now, :paid) "
            "RETURNING id, number, total_cents"
        ),
        {"tid": str(tenant_id), "sid": str(subscription_id) if subscription_id else None,
         "num": number, "status": status, "cur": currency, "sub": subtotal_cents,
         "vat": vat_cents, "tot": total_cents, "prov": provider,
         "ps": period_start, "pe": period_end, "now": now,
         "paid": now if status == "paid" else None},
    )).mappings().one()
    return dict(row)


async def record_payment(
    session, tenant_id, *, invoice_id, provider: str, provider_ref: str | None,
    amount_cents: int, currency: str, status: str, failure_reason: str | None = None,
) -> None:
    await session.execute(
        text(
            "INSERT INTO payments (tenant_id, invoice_id, provider, provider_payment_id, "
            " amount_cents, currency, status, method, failure_reason) "
            "VALUES (:tid, :inv, :prov, :ref, :amt, :cur, :status, 'card', :fail)"
        ),
        {"tid": str(tenant_id), "inv": str(invoice_id) if invoice_id else None,
         "prov": provider, "ref": provider_ref, "amt": amount_cents, "cur": currency,
         "status": status, "fail": failure_reason},
    )


# ── Checkout intent (correlates a checkout to its webhook) ───────────────────
# merchantTransactionId is short (<=16 chars), so we pass a random ref and keep the
# tenant/plan mapping in KeyDB with a TTL rather than stuffing it into the ref.

async def stash_checkout(redis, ref: str, *, tenant_id, plan_code: str, interval: str) -> None:
    if redis is None:
        return
    await redis.set(
        f"checkout:{ref}",
        json.dumps({"tenant_id": str(tenant_id), "plan_code": plan_code, "interval": interval}),
        ex=CHECKOUT_TTL_SECONDS,
    )


async def _pop_checkout(redis, ref: str) -> dict | None:
    if redis is None or not ref:
        return None
    raw = await redis.get(f"checkout:{ref}")
    if raw is None:
        return None
    await redis.delete(f"checkout:{ref}")
    return json.loads(raw.decode() if isinstance(raw, bytes) else raw)


# ── Webhook processing (idempotent) ──────────────────────────────────────────

async def process_webhook(session, redis, provider_name: str, headers: dict, raw_body: bytes) -> dict:
    """Verify, de-dupe, and act on a provider webhook. Returns a small status dict."""
    provider = get_provider(provider_name)

    if not provider.verify_webhook(headers=headers, raw_body=raw_body):
        return {"ok": False, "status": "invalid_signature"}

    wh = provider.parse_webhook(raw_body=raw_body)

    # Idempotency: the first insert wins; a replay collides and is skipped.
    inserted = (await session.execute(
        text(
            "INSERT INTO webhook_events (provider, provider_event_id, event_type, payload, status) "
            "VALUES (:prov, :eid, :etype, :payload, 'received') "
            "ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id"
        ),
        {"prov": provider_name, "eid": wh.event_id or "unknown",
         "etype": wh.kind, "payload": json.dumps(wh.raw)},
    )).scalar_one_or_none()
    if inserted is None:
        await session.commit()
        return {"ok": True, "status": "duplicate"}

    if wh.kind != "payment":
        await _mark_webhook(session, inserted, "ignored")
        await session.commit()
        return {"ok": True, "status": "ignored"}

    result = await _handle_payment(session, redis, wh)
    await _mark_webhook(session, inserted, "processed")
    await session.commit()
    return {"ok": True, "status": result}


async def _mark_webhook(session, webhook_id, status: str) -> None:
    await session.execute(
        text("UPDATE webhook_events SET status = :s, processed_at = now() WHERE id = :id"),
        {"s": status, "id": str(webhook_id)},
    )


async def _handle_payment(session, redis, wh: ProviderWebhook) -> str:
    """Apply a payment webhook: activate on checkout success, or record a renewal /
    move to past_due on failure. Returns a short status label."""
    provider = _card_provider()

    if wh.success:
        checkout = await _pop_checkout(redis, wh.reference)
        if checkout:
            # Initial subscribe: activate the plan and store the card token.
            await sub_service.assign_plan(
                session, redis, checkout["tenant_id"],
                plan_code=checkout["plan_code"], billing_interval=checkout["interval"],
                actor="system:card", provider=provider, provider_ref=wh.token,
            )
            await _invoice_and_record(session, checkout["tenant_id"], checkout["plan_code"],
                                      checkout["interval"], wh, "paid")
            return "activated"
        # Otherwise a recurring renewal against a stored token.
        sub = await _sub_by_token(session, wh.token)
        if sub:
            await _extend_period(session, sub)
            await _invoice_and_record(session, sub["tenant_id"], sub["plan_code"],
                                      sub["billing_interval"], wh, "paid")
            await ent_service.invalidate(redis, sub["tenant_id"])
            return "renewed"
        return "no_subscription_match"

    # Failed charge → past_due for the matching subscription (renewal path).
    sub = await _sub_by_token(session, wh.token)
    if sub:
        await session.execute(
            text("UPDATE subscriptions SET status='past_due', grace_until = :g, updated_at=now() "
                 "WHERE id = :id AND status='active'"),
            {"g": datetime.utcnow() + timedelta(days=sub_service.GRACE_DAYS), "id": str(sub["id"])},
        )
        await sub_service._record_event(session, sub["tenant_id"], sub["id"], "active", "past_due",
                                        "payment_failed", "system:card")
        await _invoice_and_record(session, sub["tenant_id"], sub["plan_code"],
                                  sub["billing_interval"], wh, "open", failed=True)
        await ent_service.invalidate(redis, sub["tenant_id"])
        return "payment_failed"
    return "failed_no_match"


async def _invoice_and_record(session, tenant_id, plan_code, interval, wh, invoice_status, failed=False):
    provider = _card_provider()
    sub = await _sub_by_tenant(session, tenant_id)
    subtotal = await _plan_price_cents(session, plan_code, interval, "ZAR") or (wh.amount_cents or 0)
    inv = await create_invoice(
        session, tenant_id, subscription_id=(sub["id"] if sub else None),
        subtotal_cents=subtotal, currency="ZAR", provider=provider, status=invoice_status,
    )
    await record_payment(
        session, tenant_id, invoice_id=inv["id"], provider=provider,
        provider_ref=wh.event_id, amount_cents=(wh.amount_cents or inv["total_cents"]),
        currency="ZAR", status="failed" if failed else "succeeded",
        failure_reason="payment_failed" if failed else None,
    )


async def _sub_by_token(session, token: str | None):
    if not token:
        return None
    return (await session.execute(
        text("SELECT s.id, s.tenant_id, s.billing_interval, p.code AS plan_code "
             "FROM subscriptions s JOIN plans p ON p.id = s.plan_id "
             "WHERE s.provider_subscription_id = :tok "
             "AND s.status IN ('active','past_due','restricted') LIMIT 1"),
        {"tok": token},
    )).mappings().first()


async def _sub_by_tenant(session, tenant_id):
    return (await session.execute(
        text("SELECT id FROM subscriptions WHERE tenant_id = :tid "
             "AND status IN ('trialing','active','past_due','restricted') "
             "ORDER BY created_at DESC LIMIT 1"),
        {"tid": str(tenant_id)},
    )).mappings().first()


async def _extend_period(session, sub) -> None:
    days = 365 if sub["billing_interval"] == "year" else 30
    await session.execute(
        text("UPDATE subscriptions SET status='active', current_period_start=now(), "
             "current_period_end = now() + (:days || ' days')::interval, "
             "grace_until=NULL, updated_at=now() WHERE id = :id"),
        {"days": days, "id": str(sub["id"])},
    )


# ── Recurring renewals (scheduler) ───────────────────────────────────────────

async def charge_due_card_subscriptions(session, redis) -> dict:
    """Charge every active card subscription whose period has ended. No-op unless
    Peach is configured. Each success extends the period + invoices; each failure
    moves the sub to past_due (grace) so the lifecycle job later restricts it."""
    from app.config import get_settings
    settings = get_settings()
    if not settings.card_enabled:
        return {"charged": 0, "failed": 0, "skipped": "card_disabled"}
    card = settings.CARD_PROVIDER

    due = (await session.execute(
        text(
            "SELECT s.id, s.tenant_id, s.billing_interval, s.provider_subscription_id AS token, "
            "       p.code AS plan_code "
            "FROM subscriptions s JOIN plans p ON p.id = s.plan_id "
            "WHERE s.provider = :card AND s.status = 'active' "
            "AND s.provider_subscription_id IS NOT NULL AND s.cancel_at_period_end = false "
            "AND s.current_period_end IS NOT NULL AND s.current_period_end < now()"
        ),
        {"card": card},
    )).mappings().all()

    provider = get_provider(card)
    charged = failed = 0
    for sub in due:
        subtotal = await _plan_price_cents(session, sub["plan_code"], sub["billing_interval"], "ZAR")
        if not subtotal:
            continue
        _, total = _vat_split(subtotal)
        ref = f"rnw{str(sub['id'])[:12].replace('-', '')}"
        email = await _tenant_billing_email(session, sub["tenant_id"])
        result = await provider.charge_token(
            token=sub["token"], amount_cents=total, currency="ZAR", reference=ref, email=email,
        )
        if result.success:
            await _extend_period(session, sub)
            inv = await create_invoice(session, sub["tenant_id"], subscription_id=sub["id"],
                                       subtotal_cents=subtotal, currency="ZAR", provider=card, status="paid")
            await record_payment(session, sub["tenant_id"], invoice_id=inv["id"], provider=card,
                                 provider_ref=result.provider_ref, amount_cents=total,
                                 currency="ZAR", status="succeeded")
            charged += 1
        else:
            await session.execute(
                text("UPDATE subscriptions SET status='past_due', grace_until=:g, updated_at=now() WHERE id=:id"),
                {"g": datetime.utcnow() + timedelta(days=sub_service.GRACE_DAYS), "id": str(sub["id"])},
            )
            await sub_service._record_event(session, sub["tenant_id"], sub["id"], "active", "past_due",
                                            "renewal_charge_failed", "system:card")
            await record_payment(session, sub["tenant_id"], invoice_id=None, provider=card,
                                 provider_ref=result.provider_ref, amount_cents=total, currency="ZAR",
                                 status="failed", failure_reason=result.failure_reason)
            failed += 1
        await ent_service.invalidate(redis, sub["tenant_id"])

    await session.commit()
    return {"charged": charged, "failed": failed}
