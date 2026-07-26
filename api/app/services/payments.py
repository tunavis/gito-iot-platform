"""Payment providers — the abstraction the billing engine talks to.

The billing tables + subscription engine are provider-agnostic; a provider is a
thin adapter that knows how to (a) start a card checkout that tokenises the card,
(b) charge a stored token for a renewal, and (c) verify + normalise a provider
webhook. Adding a provider = one class, no schema or engine change.

Two providers:
- `manual`  — invoiced/EFT enterprise. No card operations (they raise).
- `peach`   — Peach Payments card gateway (see peach.py).

Result shapes are normalised here so the engine (billing_ops.py) never sees a
provider-specific field.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


class ProviderNotSupported(Exception):
    """A provider was asked to do something it does not support (e.g. manual + card charge)."""


class ProviderError(Exception):
    """The gateway reached us but rejected the request (validation, decline, bad key).
    Carries the gateway's own message so the caller can surface it cleanly."""


@dataclass
class CheckoutResult:
    """Where to send the customer to enter/tokenise a card, plus the provider's own id."""
    redirect_url: str
    provider_ref: str


@dataclass
class ChargeResult:
    """Outcome of charging a stored token (recurring renewal)."""
    success: bool
    provider_ref: Optional[str] = None
    failure_reason: Optional[str] = None


@dataclass
class ProviderWebhook:
    """A provider webhook normalised to what the engine needs.

    kind: 'payment' (success/failure of a debit) | 'other' (ignored).
    event_id: the provider's unique event id — used for idempotency.
    reference: our merchantTransactionId echoed back (ties it to a subscription/invoice).
    token: the stored-card token (registrationId) if a card was tokenised.
    """
    event_id: str
    kind: str
    success: bool
    reference: Optional[str] = None
    token: Optional[str] = None
    amount_cents: Optional[int] = None
    raw: dict[str, Any] = field(default_factory=dict)


class PaymentProvider:
    """Interface every provider implements. Async because the HTTP calls are async."""

    name: str = "base"

    async def create_checkout(
        self, *, amount_cents: int, currency: str, reference: str,
        return_url: str, notify_url: str, email: str | None = None, tokenise: bool = True,
    ) -> CheckoutResult:
        raise NotImplementedError

    async def charge_token(
        self, *, token: str, amount_cents: int, currency: str, reference: str,
        email: str | None = None,
    ) -> ChargeResult:
        raise NotImplementedError

    def verify_webhook(self, *, headers: dict, raw_body: bytes) -> bool:
        raise NotImplementedError

    def parse_webhook(self, *, raw_body: bytes) -> ProviderWebhook:
        raise NotImplementedError


class ManualProvider(PaymentProvider):
    """Invoiced/EFT enterprise path — no card operations.

    Assignment + mark-paid happen through admin endpoints, not a gateway, so the
    card methods intentionally raise. Kept as a first-class provider so the rest of
    the engine treats manual and card uniformly.
    """

    name = "manual"

    async def create_checkout(self, **_):
        raise ProviderNotSupported("Manual/EFT billing does not use card checkout")

    async def charge_token(self, **_):
        raise ProviderNotSupported("Manual/EFT billing does not charge cards")

    def verify_webhook(self, **_):
        return False

    def parse_webhook(self, **_):
        raise ProviderNotSupported("Manual/EFT billing has no webhooks")


def get_provider(name: str) -> PaymentProvider:
    """Resolve a provider by name. Card adapters are imported lazily so their httpx
    dependency and config are only touched when actually used."""
    if name == "manual":
        return ManualProvider()
    if name == "paystack":
        from app.services.paystack import PaystackProvider
        return PaystackProvider()
    if name == "peach":
        from app.services.peach import PeachProvider
        return PeachProvider()
    raise ProviderNotSupported(f"Unknown payment provider: {name!r}")
