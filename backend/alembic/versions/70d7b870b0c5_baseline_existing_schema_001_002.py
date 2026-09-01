"""baseline existing schema (001 + 002)

Revision ID: 70d7b870b0c5
Revises: 
Create Date: 2026-08-28 00:33:32.296353

"""
from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = '70d7b870b0c5'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
