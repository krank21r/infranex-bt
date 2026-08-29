"""add v2.0 scoring model columns and utility_assessments table

Revision ID: 202608291409_add_v2_scoring
Revises: 003_learning_engine
Create Date: 2026-08-29 14:09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision: str = "202608291409_add_v2_scoring"
down_revision: Union[str, None] = "003_learning_engine"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "opportunity_scores",
        sa.Column("utility_score", sa.Float(), nullable=True),
        schema="public",
    )
    op.add_column(
        "opportunity_scores",
        sa.Column("technical_score", sa.Float(), nullable=True),
        schema="public",
    )
    op.add_column(
        "opportunity_scores",
        sa.Column("economics_score", sa.Float(), nullable=True),
        schema="public",
    )
    op.add_column(
        "opportunity_scores",
        sa.Column("pillar_version", sa.Text(), server_default=sa.text("'v2.0'"), nullable=True),
        schema="public",
    )
    op.add_column(
        "opportunity_scores",
        sa.Column("decision", sa.Text(), nullable=True),
        schema="public",
    )

    op.create_table(
        "utility_assessments",
        sa.Column("id", UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("netuid", sa.Integer(), nullable=False),
        sa.Column("problem_clarity", sa.Float(), nullable=True),
        sa.Column("uniqueness", sa.Float(), nullable=True),
        sa.Column("description_quality", sa.Float(), nullable=True),
        sa.Column("development_activity", sa.Float(), nullable=True),
        sa.Column("tokenomics_score", sa.Float(), nullable=True),
        sa.Column("governance_score", sa.Float(), nullable=True),
        sa.Column("overall_utility", sa.Float(), nullable=True),
        sa.Column("assessed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema="public",
    )
    op.create_index("idx_utility_assessments_netuid", "utility_assessments", ["netuid", "assessed_at"], schema="public")
    op.create_index("idx_utility_assessments_overall", "utility_assessments", ["overall_utility", "assessed_at"], schema="public")


def downgrade() -> None:
    op.drop_index("idx_utility_assessments_overall", table_name="utility_assessments", schema="public")
    op.drop_index("idx_utility_assessments_netuid", table_name="utility_assessments", schema="public")
    op.drop_table("utility_assessments", schema="public")

    op.drop_column("opportunity_scores", "decision", schema="public")
    op.drop_column("opportunity_scores", "pillar_version", schema="public")
    op.drop_column("opportunity_scores", "economics_score", schema="public")
    op.drop_column("opportunity_scores", "technical_score", schema="public")
    op.drop_column("opportunity_scores", "utility_score", schema="public")
