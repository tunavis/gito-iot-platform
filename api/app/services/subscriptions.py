"""Subscription lifecycle — the ONLY write path for subscriptions.

Every mutation (trial, plan change, cancel, resume, admin/manual assignment)
goes through here. Tenant-facing routers call these functions; there is no other
code that writes the subscriptions table. That is the actual guarantee that a
tenant cannot grant itself a plan (RLS is inert for the app's DB role — see
[[rls-is-inert-under-superuser]]), so it must not be weakened by adding writes
elsewhere.

Every mutation:
  1. runs inside the caller's session (explicit tenant scoping),
  2. appends a subscription_events row (append-only ledger),
  3. invalidates the tenant's cached entitlements.

The DB partial-unique index guarantees at most one *live* subscription per
tenant (trialing/active/past_due/restricted); these functions transition that
row rather than inserting a second.

Proration is deliberately NOT done here — for the `manual` provider a plan
change is immediate; real proration is a Stripe concern handled in that adapter.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import text

from app.services import entitlements as ent_service

LIVE_STATUSES = ent_service.LIVE_STATUSES


class SubscriptionError(HTTPException):
    """409-style lifecycle conflict (already subscribed, trial used, no live sub…)."""

    def __init__(self, detail: str, code: int = status.HTTP_409_CONFLICT):
        super().__init__(status_code=code, detail=detail)


def _period_end(start: datetime, interval: str) -> datetime:
    # Calendar-ish: 30-day month, 365-day year. Good enough for the manual path;
    # Stripe owns exact anchoring for card subscriptions.
    return start + timedelta(days=365 if interval == "year" else 30)


async def _plan(session, *, code: str, active_only: bool):
    sql = "SELECT id, code, trial_days FROM plans WHERE code = :code"
    if active_only:
        sql += " AND is_active = true"
    row = (await session.execute(text(sql), {"code": code})).mappings().first()
    if row is None:
        raise SubscriptionError(f"Plan '{code}' not found", code=status.HTTP_404_NOT_FOUND)
    return row


async def _live_subscription(session, tenant_id: str):
    return (await session.execute(
        text(
            "SELECT id, plan_id, status, cancel_at_period_end "
            "FROM subscriptions WHERE tenant_id = :tid AND status = ANY(:live) "
            "ORDER BY created_at DESC LIMIT 1"
        ),
        {"tid": tenant_id, "live": list(LIVE_STATUSES)},
    )).mappings().first()


async def _record_event(session, tenant_id, subscription_id, from_status, to_status, reason, actor):
    await session.execute(
        text(
            "INSERT INTO subscription_events "
            "(tenant_id, subscription_id, from_status, to_status, reason, actor) "
            "VALUES (:tid, :sid, :frm, :to, :reason, :actor)"
        ),
        {"tid": str(tenant_id), "sid": str(subscription_id), "frm": from_status,
         "to": to_status, "reason": reason, "actor": actor},
    )


async def _finish(session, redis, tenant_id: str):
    await session.commit()
    await ent_service.invalidate(redis, tenant_id)


async def _current(session, tenant_id: str) -> dict:
    """The tenant's current live subscription as a dict (for endpoint responses)."""
    row = (await session.execute(
        text(
            "SELECT s.status, s.provider, s.billing_interval, s.currency, s.trial_ends_at, "
            "       s.current_period_end, s.grace_until, s.cancel_at_period_end, p.code AS plan_code "
            "FROM subscriptions s JOIN plans p ON p.id = s.plan_id "
            "WHERE s.tenant_id = :tid AND s.status = ANY(:live) "
            "ORDER BY s.created_at DESC LIMIT 1"
        ),
        {"tid": tenant_id, "live": list(LIVE_STATUSES)},
    )).mappings().first()
    return dict(row) if row else {"plan_code": "free", "status": "none"}


# ── Lifecycle operations ──────────────────────────────────────────────────────

async def start_trial(session, redis, tenant_id, *, plan_code: str, actor: str,
                      email: str | None = None, signup_ip: str | None = None) -> dict:
    """Begin a trial on `plan_code`. One trial per tenant; blocked if already subscribed."""
    tid = str(tenant_id)
    if await _live_subscription(session, tid):
        raise SubscriptionError("Tenant already has an active subscription")

    # Abuse prevention: a tenant that has ever trialed cannot trial again.
    prior = (await session.execute(
        text("SELECT 1 FROM subscription_events WHERE tenant_id = :tid AND to_status = 'trialing' LIMIT 1"),
        {"tid": tid},
    )).first()
    if prior:
        raise SubscriptionError("A trial has already been used for this tenant")

    plan = await _plan(session, code=plan_code, active_only=True)
    now = datetime.utcnow()
    trial_ends = now + timedelta(days=int(plan["trial_days"] or 0))

    sid = (await session.execute(
        text(
            "INSERT INTO subscriptions "
            "(tenant_id, payer_tenant_id, plan_id, status, provider, trial_ends_at, "
            " current_period_start, current_period_end) "
            "VALUES (:tid, :tid, :pid, 'trialing', 'manual', :te, :now, :te) RETURNING id"
        ),
        {"tid": tid, "pid": str(plan["id"]), "te": trial_ends, "now": now},
    )).scalar_one()

    await _record_event(session, tid, sid, None, "trialing", f"trial:{plan_code}", actor)

    # Fingerprint for cross-tenant abuse heuristics (email domain + ip).
    if email or signup_ip:
        domain = email.split("@")[-1].lower() if email and "@" in email else None
        await session.execute(
            text(
                "INSERT INTO trial_fingerprints (tenant_id, email_domain, signup_ip) "
                "VALUES (:tid, :dom, :ip)"
            ),
            {"tid": tid, "dom": domain, "ip": signup_ip},
        )

    await _finish(session, redis, tid)
    return await _current(session, tid)


async def change_plan(session, redis, tenant_id, *, plan_code: str, actor: str) -> dict:
    """Upgrade/downgrade the live subscription to another plan (immediate for manual)."""
    tid = str(tenant_id)
    live = await _live_subscription(session, tid)
    if not live:
        raise SubscriptionError("No active subscription to change", code=status.HTTP_404_NOT_FOUND)

    plan = await _plan(session, code=plan_code, active_only=True)
    if str(plan["id"]) == str(live["plan_id"]):
        raise SubscriptionError("Already on that plan")

    await session.execute(
        text("UPDATE subscriptions SET plan_id = :pid, updated_at = now() WHERE id = :sid"),
        {"pid": str(plan["id"]), "sid": str(live["id"])},
    )
    await _record_event(session, tid, live["id"], live["status"], live["status"],
                        f"change_plan:{plan_code}", actor)
    await _finish(session, redis, tid)
    return await _current(session, tid)


async def cancel(session, redis, tenant_id, *, actor: str) -> dict:
    """Schedule cancellation at period end (keeps access until then)."""
    tid = str(tenant_id)
    live = await _live_subscription(session, tid)
    if not live:
        raise SubscriptionError("No active subscription to cancel", code=status.HTTP_404_NOT_FOUND)
    if live["cancel_at_period_end"]:
        raise SubscriptionError("Subscription is already set to cancel at period end")

    await session.execute(
        text("UPDATE subscriptions SET cancel_at_period_end = true, canceled_at = now(), "
             "updated_at = now() WHERE id = :sid"),
        {"sid": str(live["id"])},
    )
    await _record_event(session, tid, live["id"], live["status"], live["status"], "cancel_scheduled", actor)
    await _finish(session, redis, tid)
    return await _current(session, tid)


async def resume(session, redis, tenant_id, *, actor: str) -> dict:
    """Undo a scheduled cancellation before the period ends."""
    tid = str(tenant_id)
    live = await _live_subscription(session, tid)
    if not live:
        raise SubscriptionError("No active subscription to resume", code=status.HTTP_404_NOT_FOUND)
    if not live["cancel_at_period_end"]:
        raise SubscriptionError("Subscription is not scheduled to cancel")

    await session.execute(
        text("UPDATE subscriptions SET cancel_at_period_end = false, canceled_at = NULL, "
             "updated_at = now() WHERE id = :sid"),
        {"sid": str(live["id"])},
    )
    await _record_event(session, tid, live["id"], live["status"], live["status"], "resumed", actor)
    await _finish(session, redis, tid)
    return await _current(session, tid)


async def assign_plan(session, redis, tenant_id, *, plan_code: str, actor: str,
                      billing_interval: str = "month") -> dict:
    """Admin/manual: put a tenant on a plan as active (invoiced/EFT enterprise path).

    Any plan by code (incl. non-public), which is how enterprise deals are placed.
    Replaces an existing live subscription in place; otherwise creates one.
    """
    tid = str(tenant_id)
    plan = await _plan(session, code=plan_code, active_only=False)
    now = datetime.utcnow()
    period_end = _period_end(now, billing_interval)
    live = await _live_subscription(session, tid)

    if live:
        await session.execute(
            text(
                "UPDATE subscriptions SET plan_id = :pid, status = 'active', provider = 'manual', "
                "billing_interval = :interval, trial_ends_at = NULL, cancel_at_period_end = false, "
                "canceled_at = NULL, current_period_start = :now, current_period_end = :pe, "
                "updated_at = now() WHERE id = :sid"
            ),
            {"pid": str(plan["id"]), "interval": billing_interval, "now": now,
             "pe": period_end, "sid": str(live["id"])},
        )
        sid = live["id"]
        from_status = live["status"]
    else:
        sid = (await session.execute(
            text(
                "INSERT INTO subscriptions "
                "(tenant_id, payer_tenant_id, plan_id, status, provider, billing_interval, "
                " current_period_start, current_period_end) "
                "VALUES (:tid, :tid, :pid, 'active', 'manual', :interval, :now, :pe) RETURNING id"
            ),
            {"tid": tid, "pid": str(plan["id"]), "interval": billing_interval, "now": now, "pe": period_end},
        )).scalar_one()
        from_status = None

    await _record_event(session, tid, sid, from_status, "active", f"admin_assign:{plan_code}", actor)
    await _finish(session, redis, tid)
    return await _current(session, tid)
