"""Paystack adapter — card checkout, tokenised recurring charges, webhooks.

The active card gateway (Peach paused early-stage onboarding, 2026-07). Paystack
supports South Africa + ZAR. It is markedly simpler and more certain than Peach:
  - auth is a Bearer *secret key* (no OAuth token exchange),
  - amounts are integers in the minor unit (cents), passed straight through,
  - webhooks are signed HMAC-SHA512 over the RAW request body with that same secret
    key (header `x-paystack-signature`) — a documented, stable scheme, so there is
    no "guess the signed string" risk that Peach's HMAC had.

Recurring model: the first successful card charge returns
`data.authorization.authorization_code` (with `reusable: true`); we store that as
the token and charge it server-to-server via /transaction/charge_authorization for
renewals — no redirect, no 3DS re-prompt.

⚠️ SANDBOX-VERIFICATION-PENDING — not yet run against live Paystack test keys.
Confirm against a test account (fewer unknowns than Peach — the signature is fixed):
  1. ZAR is enabled on the account (Paystack activates currencies per merchant).
  2. A test card tokenises: charge.success carries authorization.authorization_code
     with reusable=true, and charge_authorization against it succeeds.
  3. The webhook URL (/api/v1/billing/webhooks/paystack) is registered in the
     dashboard and delivers charge.success with the field names used below.
Everything OUTSIDE this file (idempotency, invoicing, VAT, lifecycle) is
provider-agnostic and unit-tested.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging

import httpx

from app.config import get_settings
from app.services.payments import (
    CheckoutResult, ChargeResult, ProviderWebhook, PaymentProvider, ProviderNotSupported,
)

logger = logging.getLogger(__name__)


# ── Pure helpers (unit-testable without live keys) ───────────────────────────

def verify_signature(secret: str, raw_body: bytes, given: str) -> bool:
    """Paystack signs the raw body with HMAC-SHA512 using the secret key."""
    if not secret or not given:
        return False
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha512).hexdigest()
    return hmac.compare_digest(expected, given)


def parse_event(raw_body: bytes) -> ProviderWebhook:
    """Normalise a Paystack webhook. `charge.success` is the one we act on; the
    transaction `data.id` is unique per charge → our idempotency key."""
    body = json.loads(raw_body.decode() or "{}")
    event = body.get("event", "")
    d = body.get("data") or {}
    auth = d.get("authorization") or {}
    return ProviderWebhook(
        event_id=str(d.get("id") or d.get("reference") or ""),
        kind="payment" if event.startswith("charge.") else "other",
        success=(event == "charge.success" and d.get("status") == "success"),
        reference=d.get("reference"),
        token=auth.get("authorization_code"),
        amount_cents=d.get("amount"),  # already in cents
        raw=body,
    )


class PaystackProvider(PaymentProvider):
    name = "paystack"

    def __init__(self):
        self._settings = get_settings()
        if not self._settings.PAYSTACK_ENABLED:
            raise ProviderNotSupported(
                "Paystack is not configured (PAYSTACK_ENABLED is false — set PAYSTACK_* env from your dashboard)"
            )

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._settings.PAYSTACK_SECRET_KEY}",
                "Content-Type": "application/json"}

    # ── Checkout (collect + tokenise a card) ─────────────────────────────────
    async def create_checkout(
        self, *, amount_cents: int, currency: str, reference: str,
        return_url: str, notify_url: str, email: str | None = None, tokenise: bool = True,
    ) -> CheckoutResult:
        if not email:
            raise ProviderNotSupported("Paystack checkout requires a customer email")
        s = self._settings
        payload = {
            "email": email,
            "amount": amount_cents,      # minor unit (cents) — no conversion
            "currency": currency,
            "reference": reference,
            "callback_url": return_url,
            # A card charge tokenises automatically; the authorization_code arrives
            # on the charge.success webhook. (notify_url is set globally in the
            # Paystack dashboard, not per-transaction.)
        }
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"{s.PAYSTACK_API_URL}/transaction/initialize",
                json=payload, headers=self._headers(),
            )
            resp.raise_for_status()
            data = resp.json()
        d = data.get("data") or {}
        return CheckoutResult(redirect_url=d.get("authorization_url", ""),
                              provider_ref=d.get("reference") or reference)

    # ── Recurring charge against a stored authorization ──────────────────────
    async def charge_token(
        self, *, token: str, amount_cents: int, currency: str, reference: str,
        email: str | None = None,
    ) -> ChargeResult:
        if not email:
            return ChargeResult(success=False, failure_reason="no customer email for recurring charge")
        s = self._settings
        payload = {
            "email": email,
            "amount": amount_cents,
            "currency": currency,
            "authorization_code": token,
            "reference": reference,
        }
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"{s.PAYSTACK_API_URL}/transaction/charge_authorization",
                    json=payload, headers=self._headers(),
                )
                data = resp.json()
        except Exception as e:  # network/parse — a failed charge, not a crash
            logger.warning("Paystack charge_authorization network error: %s", e)
            return ChargeResult(success=False, failure_reason=str(e))
        d = data.get("data") or {}
        if data.get("status") and d.get("status") == "success":
            return ChargeResult(success=True, provider_ref=str(d.get("reference") or d.get("id") or ""))
        return ChargeResult(
            success=False, provider_ref=str(d.get("reference") or ""),
            failure_reason=d.get("gateway_response") or data.get("message") or "charge failed",
        )

    # ── Webhooks ─────────────────────────────────────────────────────────────
    def verify_webhook(self, *, headers: dict, raw_body: bytes) -> bool:
        given = headers.get("x-paystack-signature") or headers.get("X-Paystack-Signature") or ""
        return verify_signature(self._settings.PAYSTACK_SECRET_KEY, raw_body, given)

    def parse_webhook(self, *, raw_body: bytes) -> ProviderWebhook:
        return parse_event(raw_body)
