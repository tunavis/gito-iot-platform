# api/alembic/versions/021_drop_legacy_composite.py
"""Drop legacy composite-rule tables — superseded by unified alert_rules (JSONB conditions).

composite_alert_rules and alert_rule_conditions were the pre-unification storage
for multi-condition rules; the unified engine stores conditions inline on
alert_rules. Both tables verified empty. Final cleanup of alarm engine unification.

Revision ID: 021_drop_legacy_composite
Revises: 020_alarms_active_dedup
Create Date: 2026-07-07
"""
from typing import Sequence, Union
from alembic import op

revision: str = "021_drop_legacy_composite"
down_revision: Union[str, None] = "020_alarms_active_dedup"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # alert_rule_conditions FKs composite_alert_rules → drop child first.
    op.execute("DROP TABLE IF EXISTS alert_rule_conditions CASCADE;")
    op.execute("DROP TABLE IF EXISTS composite_alert_rules CASCADE;")


def downgrade() -> None:
    # Recreate minimal structure (empty) for reversibility; the unified engine
    # does not use these — restore only if rolling back the whole unification.
    op.execute("""
        CREATE TABLE IF NOT EXISTS composite_alert_rules (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL,
            name VARCHAR(255) NOT NULL,
            logic VARCHAR(10) NOT NULL DEFAULT 'AND',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS alert_rule_conditions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            rule_id UUID NOT NULL,
            field VARCHAR(100) NOT NULL,
            operator VARCHAR(10) NOT NULL,
            threshold DOUBLE PRECISION NOT NULL,
            weight INTEGER NOT NULL DEFAULT 1,
            sequence INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    """)
