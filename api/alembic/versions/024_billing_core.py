# api/alembic/versions/024_billing_core.py
"""Billing core — plans, entitlements, subscriptions, invoices, payments, usage.

Foundation for the SaaS subscription system (plan: peaceful-conjuring-taco).
Everything here is configuration-driven: plans, prices and the feature matrix live
in tables, so adding a plan or a feature is an INSERT, never a migration.

RLS design (important — differs from the rest of the app):
  Billing rows decide what a tenant is *entitled* to, so a tenant must be able to
  READ its own billing state but must NEVER write it. The app connects as a single
  DB role, so a role-based split isn't available. Instead each table carries two
  policies:

    <table>_read   FOR SELECT  — tenant sees only its own rows (global config tables
                                 are world-readable)
    <table>_write  FOR ALL     — requires the `app.billing_writer` GUC to be 'on'

  Only service code (webhook handler, admin endpoints, scheduler jobs) sets
  app.billing_writer. Tenant-facing request paths never do, so even a buggy or
  injected query running in a tenant context cannot grant itself a plan. Permissive
  policies are OR'd, and because the read policy is FOR SELECT only, it cannot be
  used to satisfy an UPDATE/DELETE.

  `current_setting(..., true)` (missing_ok) is deliberate: webhook/admin contexts run
  with no tenant set, and the strict form would raise instead of falling through to
  the writer policy.

Revision ID: 024_billing_core
Revises: 023_drop_redundant_indexes
Create Date: 2026-07-23
"""
from typing import Sequence, Union

from alembic import op

revision: str = "024_billing_core"
down_revision: Union[str, None] = "023_drop_redundant_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Tables holding global catalogue data — readable by everyone, writable only by
# the billing writer.
_GLOBAL_TABLES = ("plans", "plan_prices", "features", "plan_features")

# Tenant-scoped tables — a tenant reads only its own rows.
_TENANT_TABLES = (
    "subscriptions",
    "subscription_events",
    "usage_counters",
    "invoices",
    "payments",
    "trial_fingerprints",
)


def _apply_policies() -> None:
    """(Re)create RLS policies idempotently.

    Postgres has no CREATE POLICY IF NOT EXISTS, so drop-then-create is the only
    idempotent form — required by the project's migration rules.
    """
    writer = "current_setting('app.billing_writer', true) = 'on'"
    tenant = (
        "tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID"
    )

    for table in _GLOBAL_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"DROP POLICY IF EXISTS {table}_read ON {table};")
        op.execute(f"DROP POLICY IF EXISTS {table}_write ON {table};")
        # Catalogue data is not secret — the pricing page reads it unauthenticated.
        op.execute(f"CREATE POLICY {table}_read ON {table} FOR SELECT USING (true);")
        op.execute(
            f"CREATE POLICY {table}_write ON {table} FOR ALL "
            f"USING ({writer}) WITH CHECK ({writer});"
        )

    for table in _TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"DROP POLICY IF EXISTS {table}_read ON {table};")
        op.execute(f"DROP POLICY IF EXISTS {table}_write ON {table};")
        op.execute(f"CREATE POLICY {table}_read ON {table} FOR SELECT USING ({tenant});")
        op.execute(
            f"CREATE POLICY {table}_write ON {table} FOR ALL "
            f"USING ({writer}) WITH CHECK ({writer});"
        )

    # webhook_events is provider-level, never tenant-scoped: writer-only, no read policy.
    op.execute("ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;")
    op.execute("DROP POLICY IF EXISTS webhook_events_write ON webhook_events;")
    op.execute(
        f"CREATE POLICY webhook_events_write ON webhook_events FOR ALL "
        f"USING ({writer}) WITH CHECK ({writer});"
    )


def upgrade() -> None:
    # ── Catalogue: plans, prices, features, entitlement matrix ──────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS plans (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            code        VARCHAR(50)  NOT NULL UNIQUE,
            name        VARCHAR(100) NOT NULL,
            description TEXT,
            is_public   BOOLEAN NOT NULL DEFAULT true,
            is_active   BOOLEAN NOT NULL DEFAULT true,
            trial_days  INTEGER NOT NULL DEFAULT 0,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            metadata    JSONB   NOT NULL DEFAULT '{}'::jsonb,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    """)

    # Price is a child row, not a column on plans: that is what makes adding a
    # currency or an annual option configuration instead of a schema change.
    # amount_cents NULL = "contact sales" (Enterprise).
    op.execute("""
        CREATE TABLE IF NOT EXISTS plan_prices (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            plan_id           UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
            currency          CHAR(3) NOT NULL DEFAULT 'ZAR',
            billing_interval  VARCHAR(10) NOT NULL,
            amount_cents      BIGINT,
            provider          VARCHAR(30),
            provider_price_id VARCHAR(255),
            is_active         BOOLEAN NOT NULL DEFAULT true,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT valid_billing_interval
                CHECK (billing_interval IN ('month', 'year')),
            CONSTRAINT non_negative_amount
                CHECK (amount_cents IS NULL OR amount_cents >= 0)
        );
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_prices_plan_currency_interval
            ON plan_prices (plan_id, currency, billing_interval)
            WHERE is_active;
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS features (
            key         VARCHAR(80) PRIMARY KEY,
            name        VARCHAR(120) NOT NULL,
            description TEXT,
            kind        VARCHAR(20) NOT NULL,
            unit        VARCHAR(30),
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT valid_feature_kind
                CHECK (kind IN ('boolean', 'limit', 'enum'))
        );
    """)

    # value is JSONB so one row shape holds true/false, a numeric cap, or an enum.
    # NULL numeric value by convention means "unlimited".
    op.execute("""
        CREATE TABLE IF NOT EXISTS plan_features (
            plan_id     UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
            feature_key VARCHAR(80) NOT NULL REFERENCES features(key) ON DELETE CASCADE,
            value       JSONB NOT NULL,
            PRIMARY KEY (plan_id, feature_key)
        );
    """)

    # ── Subscriptions ───────────────────────────────────────────────────────
    # payer_tenant_id: normally equals tenant_id. When a parent (management)
    # tenant pays for a child, it points at the payer — the whole reseller model
    # in one nullable column, no billing_accounts abstraction needed yet.
    op.execute("""
        CREATE TABLE IF NOT EXISTS subscriptions (
            id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            payer_tenant_id          UUID REFERENCES tenants(id) ON DELETE SET NULL,
            plan_id                  UUID NOT NULL REFERENCES plans(id),
            status                   VARCHAR(20) NOT NULL,
            provider                 VARCHAR(30) NOT NULL DEFAULT 'manual',
            provider_subscription_id VARCHAR(255),
            currency                 CHAR(3) NOT NULL DEFAULT 'ZAR',
            billing_interval         VARCHAR(10) NOT NULL DEFAULT 'month',
            trial_ends_at            TIMESTAMPTZ,
            current_period_start     TIMESTAMPTZ,
            current_period_end       TIMESTAMPTZ,
            grace_until              TIMESTAMPTZ,
            cancel_at_period_end     BOOLEAN NOT NULL DEFAULT false,
            canceled_at              TIMESTAMPTZ,
            metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT valid_subscription_status CHECK (status IN (
                'trialing', 'active', 'past_due', 'restricted',
                'canceled', 'expired'
            )),
            CONSTRAINT valid_subscription_interval
                CHECK (billing_interval IN ('month', 'year'))
        );
    """)
    # One live subscription per tenant; historical/ended rows are unconstrained.
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_one_live_per_tenant
            ON subscriptions (tenant_id)
            WHERE status IN ('trialing', 'active', 'past_due', 'restricted');
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_subscriptions_trial_ends
            ON subscriptions (trial_ends_at)
            WHERE status = 'trialing';
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_subscriptions_period_end
            ON subscriptions (current_period_end)
            WHERE status IN ('active', 'past_due');
    """)

    # Append-only audit of every state transition — the billing equivalent of a ledger.
    op.execute("""
        CREATE TABLE IF NOT EXISTS subscription_events (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
            from_status     VARCHAR(20),
            to_status       VARCHAR(20) NOT NULL,
            reason          VARCHAR(100),
            actor           VARCHAR(100),
            metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_subscription_events_sub_created
            ON subscription_events (subscription_id, created_at DESC);
    """)

    # ── Usage ───────────────────────────────────────────────────────────────
    # Rolled-up counters only. Point-in-time counts (devices, users) are derived
    # live from their own tables; this stores period-cumulative metrics such as
    # API requests and notifications sent.
    op.execute("""
        CREATE TABLE IF NOT EXISTS usage_counters (
            tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            metric       VARCHAR(60) NOT NULL,
            period_start DATE NOT NULL,
            value        BIGINT NOT NULL DEFAULT 0,
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (tenant_id, metric, period_start)
        );
    """)

    # ── Invoices & payments ─────────────────────────────────────────────────
    # Serves BOTH providers: Stripe-issued invoices and manual EFT/PO invoices
    # for enterprise. po_number exists because SA procurement requires it.
    op.execute("""
        CREATE TABLE IF NOT EXISTS invoices (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            subscription_id     UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
            number              VARCHAR(50) NOT NULL UNIQUE,
            status              VARCHAR(20) NOT NULL,
            currency            CHAR(3) NOT NULL DEFAULT 'ZAR',
            subtotal_cents      BIGINT NOT NULL DEFAULT 0,
            vat_cents           BIGINT NOT NULL DEFAULT 0,
            total_cents         BIGINT NOT NULL DEFAULT 0,
            provider            VARCHAR(30) NOT NULL DEFAULT 'manual',
            provider_invoice_id VARCHAR(255),
            po_number           VARCHAR(100),
            pdf_url             TEXT,
            period_start        TIMESTAMPTZ,
            period_end          TIMESTAMPTZ,
            issued_at           TIMESTAMPTZ,
            due_at              TIMESTAMPTZ,
            paid_at             TIMESTAMPTZ,
            metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT valid_invoice_status CHECK (status IN (
                'draft', 'open', 'paid', 'void', 'uncollectible'
            ))
        );
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_invoices_tenant_created
            ON invoices (tenant_id, created_at DESC);
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_provider_invoice
            ON invoices (provider, provider_invoice_id)
            WHERE provider_invoice_id IS NOT NULL;
    """)

    # Failed attempts are rows too — dunning needs the history, not just successes.
    op.execute("""
        CREATE TABLE IF NOT EXISTS payments (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            invoice_id          UUID REFERENCES invoices(id) ON DELETE SET NULL,
            provider            VARCHAR(30) NOT NULL DEFAULT 'manual',
            provider_payment_id VARCHAR(255),
            amount_cents        BIGINT NOT NULL,
            currency            CHAR(3) NOT NULL DEFAULT 'ZAR',
            status              VARCHAR(20) NOT NULL,
            method              VARCHAR(30),
            failure_reason      TEXT,
            attempted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
            CONSTRAINT valid_payment_status CHECK (status IN (
                'pending', 'succeeded', 'failed', 'refunded'
            ))
        );
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_payments_tenant_attempted
            ON payments (tenant_id, attempted_at DESC);
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_provider_payment
            ON payments (provider, provider_payment_id)
            WHERE provider_payment_id IS NOT NULL;
    """)

    # ── Webhooks (idempotency) ──────────────────────────────────────────────
    # The UNIQUE (provider, provider_event_id) is the idempotency guarantee:
    # a replayed webhook collides on insert and is skipped rather than reprocessed.
    op.execute("""
        CREATE TABLE IF NOT EXISTS webhook_events (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            provider          VARCHAR(30) NOT NULL,
            provider_event_id VARCHAR(255) NOT NULL,
            event_type        VARCHAR(100),
            payload           JSONB NOT NULL,
            status            VARCHAR(20) NOT NULL DEFAULT 'received',
            error             TEXT,
            received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            processed_at      TIMESTAMPTZ,
            CONSTRAINT valid_webhook_status CHECK (status IN (
                'received', 'processed', 'failed', 'ignored'
            )),
            CONSTRAINT uq_webhook_provider_event UNIQUE (provider, provider_event_id)
        );
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_webhook_events_unprocessed
            ON webhook_events (received_at) WHERE status = 'received';
    """)

    # ── Trial abuse prevention ──────────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS trial_fingerprints (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            email_domain VARCHAR(255),
            email_hash   VARCHAR(64),
            signup_ip    INET,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_trial_fingerprints_lookup
            ON trial_fingerprints (email_domain, signup_ip);
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_trial_fingerprints_email_hash
            ON trial_fingerprints (email_hash);
    """)

    _apply_policies()
    _seed()


def _seed() -> None:
    """Seed the feature catalogue, the four plans and their entitlements.

    Idempotent (ON CONFLICT DO NOTHING) so re-running never disturbs values an
    operator has since tuned in the database — plans are configuration, and
    configuration belongs to whoever is running the business, not to this file.

    Prices are placeholders in ZAR cents and are expected to be set commercially
    before launch. Enterprise has no public price (contact sales).
    """
    op.execute("""
        INSERT INTO features (key, name, description, kind, unit) VALUES
          ('devices.max',            'Devices',              'Maximum provisioned devices',           'limit',   'devices'),
          ('gateways.max',           'Gateways',             'Maximum LoRaWAN/MQTT gateways',         'limit',   'gateways'),
          ('users.max',              'Users',                'Maximum user accounts',                 'limit',   'users'),
          ('dashboards.max',         'Dashboards',           'Maximum dashboards',                    'limit',   'dashboards'),
          ('api.requests_per_day',   'API requests',         'API requests per day',                  'limit',   'requests/day'),
          ('retention.days',         'Data retention',       'Telemetry retention window',            'limit',   'days'),
          ('storage.gb',             'Storage',              'Telemetry storage allowance',           'limit',   'GB'),
          ('notifications.per_month','Notifications',        'Outbound notifications per month',      'limit',   'messages/month'),
          ('automations.max',        'Automations',          'Maximum alert/automation rules',        'limit',   'rules'),
          ('analytics.advanced',     'Advanced analytics',   'Aggregations, trends, comparisons',     'boolean', NULL),
          ('reporting.enabled',      'Reporting',            'Scheduled and ad-hoc reports',          'boolean', NULL),
          ('export.enabled',         'Data export',          'CSV/API bulk export',                   'boolean', NULL),
          ('ai.enabled',             'AI features',          'Anomaly detection and AI insights',     'boolean', NULL),
          ('support.level',          'Support',              'Support tier',                          'enum',    NULL)
        ON CONFLICT (key) DO NOTHING;
    """)

    op.execute("""
        INSERT INTO plans (code, name, description, is_public, trial_days, sort_order) VALUES
          ('free',         'Free',         'Evaluate the platform with a small deployment.',        true,  0,  10),
          ('starter',      'Starter',      'Single-site monitoring for small operations.',          true,  14, 20),
          ('professional', 'Professional', 'Multi-site monitoring with analytics and reporting.',   true,  14, 30),
          ('enterprise',   'Enterprise',   'Large-scale deployments with dedicated support.',       true,  14, 40)
        ON CONFLICT (code) DO NOTHING;
    """)

    op.execute("""
        INSERT INTO plan_prices (plan_id, currency, billing_interval, amount_cents)
        SELECT p.id, 'ZAR', v.billing_interval, v.amount_cents
        FROM plans p
        JOIN (VALUES
            ('free',         'month',       0::bigint),
            ('free',         'year',        0::bigint),
            ('starter',      'month',   99900::bigint),
            ('starter',      'year',   999000::bigint),
            ('professional', 'month',  299900::bigint),
            ('professional', 'year',  2999000::bigint),
            ('enterprise',   'month',    NULL::bigint),
            ('enterprise',   'year',     NULL::bigint)
        ) AS v(code, billing_interval, amount_cents) ON v.code = p.code
        ON CONFLICT DO NOTHING;
    """)

    # NULL = unlimited. Enterprise limits are deliberately NULL and negotiated.
    op.execute("""
        INSERT INTO plan_features (plan_id, feature_key, value)
        SELECT p.id, v.feature_key, v.value::jsonb
        FROM plans p
        JOIN (VALUES
            ('free',         'devices.max',             '5'),
            ('free',         'gateways.max',            '1'),
            ('free',         'users.max',               '2'),
            ('free',         'dashboards.max',          '1'),
            ('free',         'api.requests_per_day',    '1000'),
            ('free',         'retention.days',          '7'),
            ('free',         'storage.gb',              '1'),
            ('free',         'notifications.per_month', '100'),
            ('free',         'automations.max',         '3'),
            ('free',         'analytics.advanced',      'false'),
            ('free',         'reporting.enabled',       'false'),
            ('free',         'export.enabled',          'false'),
            ('free',         'ai.enabled',              'false'),
            ('free',         'support.level',           '"community"'),

            ('starter',      'devices.max',             '50'),
            ('starter',      'gateways.max',            '3'),
            ('starter',      'users.max',               '5'),
            ('starter',      'dashboards.max',          '5'),
            ('starter',      'api.requests_per_day',    '25000'),
            ('starter',      'retention.days',          '90'),
            ('starter',      'storage.gb',              '10'),
            ('starter',      'notifications.per_month', '2000'),
            ('starter',      'automations.max',         '25'),
            ('starter',      'analytics.advanced',      'false'),
            ('starter',      'reporting.enabled',       'false'),
            ('starter',      'export.enabled',          'true'),
            ('starter',      'ai.enabled',              'false'),
            ('starter',      'support.level',           '"email"'),

            ('professional', 'devices.max',             '500'),
            ('professional', 'gateways.max',            '25'),
            ('professional', 'users.max',               '25'),
            ('professional', 'dashboards.max',          '25'),
            ('professional', 'api.requests_per_day',    '250000'),
            ('professional', 'retention.days',          '365'),
            ('professional', 'storage.gb',              '100'),
            ('professional', 'notifications.per_month', '25000'),
            ('professional', 'automations.max',         '250'),
            ('professional', 'analytics.advanced',      'true'),
            ('professional', 'reporting.enabled',       'true'),
            ('professional', 'export.enabled',          'true'),
            ('professional', 'ai.enabled',              'false'),
            ('professional', 'support.level',           '"priority"'),

            ('enterprise',   'devices.max',             'null'),
            ('enterprise',   'gateways.max',            'null'),
            ('enterprise',   'users.max',               'null'),
            ('enterprise',   'dashboards.max',          'null'),
            ('enterprise',   'api.requests_per_day',    'null'),
            ('enterprise',   'retention.days',          '1095'),
            ('enterprise',   'storage.gb',              'null'),
            ('enterprise',   'notifications.per_month', 'null'),
            ('enterprise',   'automations.max',         'null'),
            ('enterprise',   'analytics.advanced',      'true'),
            ('enterprise',   'reporting.enabled',       'true'),
            ('enterprise',   'export.enabled',          'true'),
            ('enterprise',   'ai.enabled',              'true'),
            ('enterprise',   'support.level',           '"dedicated"')
        ) AS v(code, feature_key, value) ON v.code = p.code
        ON CONFLICT (plan_id, feature_key) DO NOTHING;
    """)


def downgrade() -> None:
    for table in (
        "webhook_events",
        "trial_fingerprints",
        "payments",
        "invoices",
        "usage_counters",
        "subscription_events",
        "subscriptions",
        "plan_features",
        "features",
        "plan_prices",
        "plans",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE;")
