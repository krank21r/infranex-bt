"""learning engine tables (003)

Revision ID: 003_learning_engine
Revises: 70d7b870b0c5
Create Date: 2026-08-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


revision: str = "003_learning_engine"
down_revision: Union[str, None] = "70d7b870b0c5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "performance_reports",
        sa.Column("id", UUID(as_uuid=False), server_default=sa.text("uuid_generate_v4()"), nullable=False),
        sa.Column("deployment_id", UUID(as_uuid=False), nullable=True),
        sa.Column("netuid", sa.Integer(), nullable=False),
        sa.Column("report_type", sa.Text(), nullable=False),
        sa.Column("window_days", sa.Integer(), nullable=False),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("total_revenue", sa.Float(), nullable=True),
        sa.Column("total_cost", sa.Float(), nullable=True),
        sa.Column("total_profit", sa.Float(), nullable=True),
        sa.Column("roi", sa.Float(), nullable=True),
        sa.Column("uptime_ratio", sa.Float(), nullable=True),
        sa.Column("emission_per_block_avg", sa.Float(), nullable=True),
        sa.Column("emission_per_block_median", sa.Float(), nullable=True),
        sa.Column("health_score_avg", sa.Float(), nullable=True),
        sa.Column("sample_size", sa.Integer(), server_default="0", nullable=False),
        sa.Column("model_version", sa.Text(), nullable=True),
        sa.Column("metadata", JSONB(), server_default="{}", nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["deployment_id"], ["public.deployments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="public",
    )
    op.create_index("idx_perf_reports_deployment", "performance_reports", ["deployment_id", "created_at"], schema="public")
    op.create_index("idx_perf_reports_netuid", "performance_reports", ["netuid", "report_type", "created_at"], schema="public")
    op.create_index("idx_perf_reports_type_window", "performance_reports", ["report_type", "window_days", "created_at"], schema="public")

    op.create_table(
        "accuracy_tracking",
        sa.Column("id", UUID(as_uuid=False), server_default=sa.text("uuid_generate_v4()"), nullable=False),
        sa.Column("opportunity_score_id", UUID(as_uuid=False), nullable=True),
        sa.Column("deployment_id", UUID(as_uuid=False), nullable=True),
        sa.Column("netuid", sa.Integer(), nullable=False),
        sa.Column("predicted_score", sa.Float(), nullable=False),
        sa.Column("actual_roi_7d", sa.Float(), nullable=True),
        sa.Column("actual_roi_14d", sa.Float(), nullable=True),
        sa.Column("actual_roi_30d", sa.Float(), nullable=True),
        sa.Column("actual_roi", sa.Float(), nullable=True),
        sa.Column("error_percentage", sa.Float(), nullable=True),
        sa.Column("absolute_error", sa.Float(), nullable=True),
        sa.Column("component_errors", JSONB(), server_default="{}", nullable=True),
        sa.Column("score_model_version", sa.Text(), nullable=True),
        sa.Column("evaluation_days", sa.Integer(), server_default="0", nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["opportunity_score_id"], ["public.opportunity_scores.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["deployment_id"], ["public.deployments.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        schema="public",
    )
    op.create_index("idx_accuracy_opportunity", "accuracy_tracking", ["opportunity_score_id", "recorded_at"], schema="public")
    op.create_index("idx_accuracy_deployment", "accuracy_tracking", ["deployment_id", "recorded_at"], schema="public")
    op.create_index("idx_accuracy_netuid", "accuracy_tracking", ["netuid", "recorded_at"], schema="public")
    op.create_index("idx_accuracy_model_version", "accuracy_tracking", ["score_model_version", "recorded_at"], schema="public")

    op.create_table(
        "weight_adjustments",
        sa.Column("id", UUID(as_uuid=False), server_default=sa.text("uuid_generate_v4()"), nullable=False),
        sa.Column("model_version", sa.Text(), nullable=False),
        sa.Column("previous_weights", JSONB(), nullable=False),
        sa.Column("new_weights", JSONB(), nullable=False),
        sa.Column("adjustments", JSONB(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("accuracy_report_id", UUID(as_uuid=False), nullable=True),
        sa.Column("applied", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema="public",
    )
    op.create_index("idx_weight_adj_model", "weight_adjustments", ["model_version", "created_at"], schema="public")
    op.create_index("idx_weight_adj_applied", "weight_adjustments", ["applied", "created_at"], schema="public")

    op.create_table(
        "drift_alerts",
        sa.Column("id", UUID(as_uuid=False), server_default=sa.text("uuid_generate_v4()"), nullable=False),
        sa.Column("model_version", sa.Text(), nullable=False),
        sa.Column("metric_name", sa.Text(), nullable=False),
        sa.Column("current_value", sa.Float(), nullable=False),
        sa.Column("baseline_value", sa.Float(), nullable=False),
        sa.Column("drift_ratio", sa.Float(), nullable=False),
        sa.Column("threshold", sa.Float(), nullable=False),
        sa.Column("severity", sa.Text(), server_default="warning", nullable=False),
        sa.Column("is_resolved", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema="public",
    )
    op.create_index("idx_drift_alerts_model", "drift_alerts", ["model_version", "created_at"], schema="public")
    op.create_index(
        "idx_drift_alerts_unresolved",
        "drift_alerts",
        ["is_resolved", "created_at"],
        schema="public",
        postgresql_where=sa.text("is_resolved = false"),
    )
    op.create_index("idx_drift_alerts_severity", "drift_alerts", ["severity", "is_resolved", "created_at"], schema="public")


def downgrade() -> None:
    op.drop_index("idx_drift_alerts_severity", table_name="drift_alerts", schema="public")
    op.drop_index("idx_drift_alerts_unresolved", table_name="drift_alerts", schema="public")
    op.drop_index("idx_drift_alerts_model", table_name="drift_alerts", schema="public")
    op.drop_table("drift_alerts", schema="public")

    op.drop_index("idx_weight_adj_applied", table_name="weight_adjustments", schema="public")
    op.drop_index("idx_weight_adj_model", table_name="weight_adjustments", schema="public")
    op.drop_table("weight_adjustments", schema="public")

    op.drop_index("idx_accuracy_model_version", table_name="accuracy_tracking", schema="public")
    op.drop_index("idx_accuracy_netuid", table_name="accuracy_tracking", schema="public")
    op.drop_index("idx_accuracy_deployment", table_name="accuracy_tracking", schema="public")
    op.drop_index("idx_accuracy_opportunity", table_name="accuracy_tracking", schema="public")
    op.drop_table("accuracy_tracking", schema="public")

    op.drop_index("idx_perf_reports_type_window", table_name="performance_reports", schema="public")
    op.drop_index("idx_perf_reports_netuid", table_name="performance_reports", schema="public")
    op.drop_index("idx_perf_reports_deployment", table_name="performance_reports", schema="public")
    op.drop_table("performance_reports", schema="public")
