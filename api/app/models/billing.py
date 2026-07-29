"""Billing models — plans, entitlements, subscriptions, invoices, payments, usage.

Schema is created by Alembic migration 024_billing_core (the source of truth for
DDL, RLS policies and seed data). These ORM classes mirror that schema for use in
service code; keep the two in sync.

Design notes live in the migration; the short version:
- Plans/prices/features/plan_features are configuration (adding one is an INSERT).
- A trial is just subscriptions.status='trialing' + trial_ends_at, not its own table.
- plan_features.value is JSONB so one shape holds booleans, numeric limits and enums;
  a NULL numeric value means "unlimited".
- subscriptions.payer_tenant_id defaults to tenant_id; pointing it elsewhere is the
  whole reseller/white-label model in one column.
"""

from datetime import datetime
import uuid

from sqlalchemy import (
    Column,
    String,
    DateTime,
    Date,
    ForeignKey,
    CheckConstraint,
    Text,
    Integer,
    BigInteger,
    Boolean,
    Index,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB, INET

from app.models.base import BaseModel


# ── Catalogue ────────────────────────────────────────────────────────────────


class Plan(BaseModel):
    """A sellable plan. Configuration, not code — new plans are INSERTs."""

    __tablename__ = "plans"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(50), nullable=False, unique=True)
    name = Column(String(100), nullable=False)
    description = Column(Text)
    is_public = Column(Boolean, nullable=False, default=True)
    is_active = Column(Boolean, nullable=False, default=True)
    trial_days = Column(Integer, nullable=False, default=0)
    sort_order = Column(Integer, nullable=False, default=0)
    plan_metadata = Column("metadata", JSONB, nullable=False, default={})
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


class PlanPrice(BaseModel):
    """A plan's price for one (currency, interval). amount_cents NULL = contact sales."""

    __tablename__ = "plan_prices"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("plans.id", ondelete="CASCADE"), nullable=False)
    currency = Column(String(3), nullable=False, default="ZAR")
    billing_interval = Column(String(10), nullable=False)
    amount_cents = Column(BigInteger)
    provider = Column(String(30))
    provider_price_id = Column(String(255))
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint("billing_interval IN ('month', 'year')", name="valid_billing_interval"),
        CheckConstraint("amount_cents IS NULL OR amount_cents >= 0", name="non_negative_amount"),
    )


class Feature(BaseModel):
    """A capability the platform can gate on. `key` is the stable entitlement id."""

    __tablename__ = "features"

    key = Column(String(80), primary_key=True)
    name = Column(String(120), nullable=False)
    description = Column(Text)
    kind = Column(String(20), nullable=False)  # boolean | limit | enum
    unit = Column(String(30))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint("kind IN ('boolean', 'limit', 'enum')", name="valid_feature_kind"),
    )


class PlanFeature(BaseModel):
    """The entitlement matrix: what each plan grants for each feature.

    value is JSONB — true/false for boolean features, a number (or JSON null =
    unlimited) for limits, a quoted string for enums.
    """

    __tablename__ = "plan_features"

    plan_id = Column(
        UUID(as_uuid=True), ForeignKey("plans.id", ondelete="CASCADE"), primary_key=True
    )
    feature_key = Column(
        String(80), ForeignKey("features.key", ondelete="CASCADE"), primary_key=True
    )
    value = Column(JSONB, nullable=False)


# ── Subscriptions ──────────────────────────────────────────────────────────────


class Subscription(BaseModel):
    """A tenant's subscription. At most one live row per tenant (partial unique index)."""

    __tablename__ = "subscriptions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    payer_tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True
    )
    plan_id = Column(UUID(as_uuid=True), ForeignKey("plans.id"), nullable=False)
    status = Column(String(20), nullable=False)
    provider = Column(String(30), nullable=False, default="manual")
    provider_subscription_id = Column(String(255))
    currency = Column(String(3), nullable=False, default="ZAR")
    billing_interval = Column(String(10), nullable=False, default="month")
    trial_ends_at = Column(DateTime(timezone=True))
    current_period_start = Column(DateTime(timezone=True))
    current_period_end = Column(DateTime(timezone=True))
    grace_until = Column(DateTime(timezone=True))
    cancel_at_period_end = Column(Boolean, nullable=False, default=False)
    canceled_at = Column(DateTime(timezone=True))
    subscription_metadata = Column("metadata", JSONB, nullable=False, default={})
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "status IN ('trialing', 'active', 'past_due', 'restricted', 'canceled', 'expired')",
            name="valid_subscription_status",
        ),
        CheckConstraint(
            "billing_interval IN ('month', 'year')", name="valid_subscription_interval"
        ),
    )


class SubscriptionEvent(BaseModel):
    """Append-only ledger of subscription status transitions."""

    __tablename__ = "subscription_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    subscription_id = Column(
        UUID(as_uuid=True), ForeignKey("subscriptions.id", ondelete="CASCADE"), nullable=False
    )
    from_status = Column(String(20))
    to_status = Column(String(20), nullable=False)
    reason = Column(String(100))
    actor = Column(String(100))
    event_metadata = Column("metadata", JSONB, nullable=False, default={})
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


# ── Usage ────────────────────────────────────────────────────────────────────


class UsageCounter(BaseModel):
    """Period-cumulative metering (API requests, notifications sent).

    Point-in-time counts (devices, users) are derived live from their own tables,
    not stored here.
    """

    __tablename__ = "usage_counters"

    tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True
    )
    metric = Column(String(60), primary_key=True)
    period_start = Column(Date, primary_key=True)
    value = Column(BigInteger, nullable=False, default=0)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


# ── Invoices & payments ────────────────────────────────────────────────────────


class Invoice(BaseModel):
    """An invoice — provider-issued (Stripe) or manual (enterprise EFT/PO)."""

    __tablename__ = "invoices"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    subscription_id = Column(
        UUID(as_uuid=True), ForeignKey("subscriptions.id", ondelete="SET NULL"), nullable=True
    )
    number = Column(String(50), nullable=False, unique=True)
    status = Column(String(20), nullable=False)
    currency = Column(String(3), nullable=False, default="ZAR")
    subtotal_cents = Column(BigInteger, nullable=False, default=0)
    vat_cents = Column(BigInteger, nullable=False, default=0)
    total_cents = Column(BigInteger, nullable=False, default=0)
    provider = Column(String(30), nullable=False, default="manual")
    provider_invoice_id = Column(String(255))
    po_number = Column(String(100))
    pdf_url = Column(Text)
    period_start = Column(DateTime(timezone=True))
    period_end = Column(DateTime(timezone=True))
    issued_at = Column(DateTime(timezone=True))
    due_at = Column(DateTime(timezone=True))
    paid_at = Column(DateTime(timezone=True))
    invoice_metadata = Column("metadata", JSONB, nullable=False, default={})
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "status IN ('draft', 'open', 'paid', 'void', 'uncollectible')",
            name="valid_invoice_status",
        ),
    )


class Payment(BaseModel):
    """A payment attempt — failures are rows too, for dunning history."""

    __tablename__ = "payments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    invoice_id = Column(
        UUID(as_uuid=True), ForeignKey("invoices.id", ondelete="SET NULL"), nullable=True
    )
    provider = Column(String(30), nullable=False, default="manual")
    provider_payment_id = Column(String(255))
    amount_cents = Column(BigInteger, nullable=False)
    currency = Column(String(3), nullable=False, default="ZAR")
    status = Column(String(20), nullable=False)
    method = Column(String(30))
    failure_reason = Column(Text)
    attempted_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    payment_metadata = Column("metadata", JSONB, nullable=False, default={})

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'succeeded', 'failed', 'refunded')",
            name="valid_payment_status",
        ),
    )


# ── Webhooks & abuse prevention ──────────────────────────────────────────────


class WebhookEvent(BaseModel):
    """Provider webhook envelope. UNIQUE(provider, provider_event_id) = idempotency."""

    __tablename__ = "webhook_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider = Column(String(30), nullable=False)
    provider_event_id = Column(String(255), nullable=False)
    event_type = Column(String(100))
    payload = Column(JSONB, nullable=False)
    status = Column(String(20), nullable=False, default="received")
    error = Column(Text)
    received_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    processed_at = Column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(
            "status IN ('received', 'processed', 'failed', 'ignored')",
            name="valid_webhook_status",
        ),
        Index("uq_webhook_provider_event", "provider", "provider_event_id", unique=True),
    )


class TrialFingerprint(BaseModel):
    """Signals used to block repeat trial signups (abuse prevention)."""

    __tablename__ = "trial_fingerprints"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    email_domain = Column(String(255))
    email_hash = Column(String(64))
    signup_ip = Column(INET)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
