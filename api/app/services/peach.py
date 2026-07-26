"""Peach Payments adapter — card checkout, tokenised recurring charges, webhooks.

Implements the PaymentProvider interface against Peach's Checkout V2 API. Built
from Peach's published docs (developer.peachpayments.com); all endpoints,
credentials and the webhook secret come from config (PEACH_* env), and the whole
provider is inert unless PEACH_ENABLED is set.

⚠️ SANDBOX-VERIFICATION-PENDING — this HTTP layer has NOT been run against a live
Peach sandbox (no credentials yet). Before going live, verify against sandbox:
  1. PEACH_AUTH_URL / PEACH_API_URL — exact base URLs for your account/region.
  2. The auth request shape (client credentials → access_token) below.
  3. The create-checkout field names + the redirect URL field in the response.
  4. The recurring server-to-server charge endpoint + standingInstruction fields.
  5. verify_webhook() — the EXACT string Peach signs (parameter ordering) for the
     HMAC-SHA256 signature. This is the most likely thing to need adjustment.
Everything OUTSIDE this file (idempotency, invoicing, lifecycle) is unit-tested
and provider-independent, so only these ~5 points need sandbox confirmation.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import re
import time
from typing import Optional
from urllib.parse import parse_qs

import httpx

from app.config import get_settings
from app.services.payments import (
    CheckoutResult, ChargeResult, ProviderWebhook, PaymentProvider, ProviderNotSupported,
)

logger = logging.getLogger(__name__)

# OPPWA/Peach result-code families. A payment is successful when the code matches
# one of these; anything else is a failure (or pending, treated as not-yet-success).
_SUCCESS = re.compile(r"^(000\.000\.|000\.100\.1|000\.[36]00\.)")
_PENDING = re.compile(r"^(000\.200)")


def _amount_str(amount_cents: int) -> str:
    """Peach expects a decimal amount string ("10.00"), not integer cents."""
    return f"{amount_cents / 100:.2f}"


def is_success_code(result_code: str) -> bool:
    return bool(result_code and _SUCCESS.match(result_code))


def is_pending_code(result_code: str) -> bool:
    return bool(result_code and _PENDING.match(result_code))


class PeachProvider(PaymentProvider):
    name = "peach"

    def __init__(self):
        self._settings = get_settings()
        if not self._settings.PEACH_ENABLED:
            raise ProviderNotSupported(
                "Peach is not configured (PEACH_ENABLED is false — set PEACH_* env from your dashboard)"
            )
        self._token: Optional[str] = None
        self._token_expiry: float = 0.0

    # ── Auth ─────────────────────────────────────────────────────────────────
    async def _access_token(self) -> str:
        """Cached OAuth access token (client credentials). Refreshes ~1 min early."""
        if self._token and time.time() < self._token_expiry - 60:
            return self._token
        s = self._settings
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                s.PEACH_AUTH_URL,
                json={
                    "clientId": s.PEACH_CLIENT_ID,
                    "clientSecret": s.PEACH_CLIENT_SECRET,
                    "merchantId": s.PEACH_MERCHANT_ID,
                },
            )
            resp.raise_for_status()
            data = resp.json()
        self._token = data["access_token"]
        self._token_expiry = time.time() + int(data.get("expires_in", 3600))
        return self._token

    # ── Checkout (collect + tokenise a card) ─────────────────────────────────
    async def create_checkout(
        self, *, amount_cents: int, currency: str, reference: str,
        return_url: str, notify_url: str, tokenise: bool = True,
    ) -> CheckoutResult:
        token = await self._access_token()
        s = self._settings
        payload = {
            "authentication": {"entityId": s.PEACH_ENTITY_ID},
            "amount": _amount_str(amount_cents),
            "currency": currency,
            "merchantTransactionId": reference,
            "shopperResultUrl": return_url,
            "notificationUrl": notify_url,
            # createRegistration=true → Peach stores the card and returns a
            # registrationId (our recurring token) on the resulting webhook.
            "createRegistration": tokenise,
        }
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"{s.PEACH_API_URL}/v2/checkout",
                json=payload,
                headers={"Authorization": f"Bearer {token}"},
            )
            resp.raise_for_status()
            data = resp.json()
        # V2 returns a checkoutId + a redirect/embed URL to send the shopper to.
        checkout_id = data.get("checkoutId") or data.get("id", "")
        redirect = data.get("redirectUrl") or data.get("url") or ""
        return CheckoutResult(redirect_url=redirect, provider_ref=checkout_id)

    # ── Recurring charge against a stored token ──────────────────────────────
    async def charge_token(
        self, *, token: str, amount_cents: int, currency: str, reference: str,
    ) -> ChargeResult:
        access = await self._access_token()
        s = self._settings
        payload = {
            "authentication": {"entityId": s.PEACH_ENTITY_ID},
            "amount": _amount_str(amount_cents),
            "currency": currency,
            "paymentType": "DB",  # debit
            "merchantTransactionId": reference,
            # Merchant-initiated recurring transaction against the stored card.
            "standingInstruction": {"source": "MIT", "mode": "REPEATED", "type": "RECURRING"},
        }
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"{s.PEACH_API_URL}/v1/registrations/{token}/payments",
                    json=payload,
                    headers={"Authorization": f"Bearer {access}"},
                )
                data = resp.json()
        except Exception as e:  # network/parse — a failed charge, not a crash
            logger.warning("Peach charge_token network error: %s", e)
            return ChargeResult(success=False, failure_reason=str(e))

        code = (data.get("result") or {}).get("code", "")
        if is_success_code(code):
            return ChargeResult(success=True, provider_ref=data.get("id"))
        return ChargeResult(
            success=False, provider_ref=data.get("id"),
            failure_reason=(data.get("result") or {}).get("description", code or "charge failed"),
        )

    # ── Webhooks ─────────────────────────────────────────────────────────────
    def verify_webhook(self, *, headers: dict, raw_body: bytes) -> bool:
        """HMAC-SHA256 verification.

        Peach signs webhooks with a shared secret; the `signature` field is the
        HMAC-SHA256 over the other parameters. Peach's documented method sorts the
        parameters by key and concatenates key+value, then HMACs that string.
        ⚠️ Confirm the exact concatenation against sandbox — providers vary here.
        """
        secret = self._settings.PEACH_WEBHOOK_SECRET
        if not secret:
            return False
        params = {k: v[0] for k, v in parse_qs(raw_body.decode(), keep_blank_values=True).items()}
        given = params.pop("signature", "")
        signed_string = "".join(f"{k}{params[k]}" for k in sorted(params))
        expected = hmac.new(secret.encode(), signed_string.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, given)

    def parse_webhook(self, *, raw_body: bytes) -> ProviderWebhook:
        params = {k: v[0] for k, v in parse_qs(raw_body.decode(), keep_blank_values=True).items()}
        code = params.get("result.code", "")
        amount = params.get("amount")
        return ProviderWebhook(
            # `id` is the payment id (unique per event) — our idempotency key.
            event_id=params.get("id") or params.get("checkoutId", ""),
            kind="payment" if params.get("paymentType") in ("DB", "PA") else "other",
            success=is_success_code(code),
            reference=params.get("merchantTransactionId"),
            token=params.get("registrationId"),
            amount_cents=round(float(amount) * 100) if amount else None,
            raw=params,
        )
