"""v2.0 scoring columns on opportunity_scores (004)

Revision ID: 004_v2_scoring_columns
Revises: 003_learning_engine
Create Date: 2026-08-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "004_v2_scoring_columns"
down_revision: Union[str, None] = "003_learning_engine"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("opportunity_scores", sa.Column("utility_score", sa.Float(), nullable=True))
    op.add_column("opportunity_scores", sa.Column("technical_score", sa.Float(), nullable=True))
    op.add_column("opportunity_scores", sa.Column("economics_score", sa.Float(), nullable=True))
    op.add_column("opportunity_scores", sa.Column("pillar_version", sa.Text(), nullable=True))
    op.add_column("opportunity_scores", sa.Column("decision", sa.Text(), nullable=True))
    op.create_index("idx_opportunity_scores_decision", "opportunity_scores", ["decision"])


def downgrade() -> None:
    op.drop_index("idx_opportunity_scores_decision", table_name="opportunity_scores")
    op.drop_column("opportunity_scores", "decision")
    op.drop_column("opportunity_scores", "pillar_version")
    op.drop_column("opportunity_scores", "economics_score")
    op.drop_column("opportunity_scores", "technical_score")
    op.drop_column("opportunity_scores", "utility_score")
