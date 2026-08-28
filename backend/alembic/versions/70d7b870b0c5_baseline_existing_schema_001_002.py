"""baseline existing schema (001 + 002)

Revision ID: 70d7b870b0c5
Revises: 
Create Date: 2026-08-28 00:33:32.296353

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '70d7b870b0c5'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
