# api/alembic/versions/025_backfill_subscriptions.py
"""Grandfather existing tenants before billing enforcement goes live.

Enforcement (next step) would hold any tenant with no subscription to the free
tier — but every existing tenant predates billing and is already over free
limits (the demo tenant has 68 devices vs the free cap of 5). Without this, the
moment enforcement deploys, existing customers can't create devices/users.

Fix: an internal, non-sellable "legacy" plan with UNLIMITED everything, and an
active subscription on it for every tenant that doesn't already have a live one.
New signups (post-billing) get no such row and resolve to the free tier, so they
ARE enforced. Idempotent — safe to re-run and safe on fresh DBs (no tenants yet
→ inserts nothing).

Revision ID: 025_backfill_subscriptions
Revises: 024_billing_core
Create Date: 2026-07-25
"""
from typing import Sequence, Union

from alembic import op

revision: str = "025_backfill_subscriptions"
down_revision: Union[str, None] = "024_billing_core"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LEGACY_CODE = "legacy_grandfathered"


def upgrade() -> None:
    # Internal plan: not public, not active (never listed or sold), unlimited.
    op.execute(f"""
        INSERT INTO plans (code, name, description, is_public, is_active, trial_days, sort_order)
        VALUES (
            '{LEGACY_CODE}', 'Legacy (grandfathered)',
            'Internal plan for tenants that predate billing. Not sold. Unlimited limits '
            'so enforcement never blocks an existing customer.',
            false, false, 0, 999
        )
        ON CONFLICT (code) DO NOTHING;
    """)

    # Unlimited entitlements, derived from whatever features exist:
    # limits → null (unlimited), booleans → true, enums → highest tier.
    op.execute(f"""
        INSERT INTO plan_features (plan_id, feature_key, value)
        SELECT p.id, f.key,
               CASE f.kind
                   WHEN 'limit'   THEN 'null'::jsonb
                   WHEN 'boolean' THEN 'true'::jsonb
                   WHEN 'enum'    THEN '"dedicated"'::jsonb
               END
        FROM plans p CROSS JOIN features f
        WHERE p.code = '{LEGACY_CODE}'
        ON CONFLICT (plan_id, feature_key) DO NOTHING;
    """)

    # One active legacy subscription per existing tenant that has no live one.
    # The partial-unique index (one live sub per tenant) + NOT EXISTS keep it idempotent.
    op.execute(f"""
        INSERT INTO subscriptions (tenant_id, payer_tenant_id, plan_id, status, provider)
        SELECT t.id, t.id, p.id, 'active', 'manual'
        FROM tenants t
        CROSS JOIN plans p
        WHERE p.code = '{LEGACY_CODE}'
          AND NOT EXISTS (
              SELECT 1 FROM subscriptions s
              WHERE s.tenant_id = t.id
                AND s.status IN ('trialing', 'active', 'past_due', 'restricted')
          );
    """)


def downgrade() -> None:
    # Remove only what this migration added: legacy subscriptions + the plan.
    op.execute(f"""
        DELETE FROM subscriptions
        WHERE plan_id = (SELECT id FROM plans WHERE code = '{LEGACY_CODE}');
    """)
    op.execute(f"DELETE FROM plans WHERE code = '{LEGACY_CODE}';")
