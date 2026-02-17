"""Drop solution_templates table

Revision ID: 004_drop_solution_templates
Revises: 003_drop_valid_metric
Create Date: 2026-02-14
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '004_drop_solution_templates'
down_revision: Union[str, None] = '003_drop_valid_metric'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS solution_templates CASCADE;")


def downgrade() -> None:
    pass
