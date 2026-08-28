"""
Phase 1B schema extensions — approval, audit, automation, drift, change tracking.

Maps 1:1 to tables defined in `database/migrations/002_approval_audit_drift.sql`.
The SQL migration is the source of truth; this file reflects it.

Architecture reference: memory/project-architecture-spec.md
"""
from sqlalchemy import String, Integer, Float, Text, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY
from sqlalchemy.orm import Mapped, mapped_column
from typing import Optional
from datetime import datetime

from .base import Base, TimestampMixin


class ApprovalRequest(Base, TimestampMixin):
    __tablename__ = "approval_requests"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    action_type: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    level: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending", index=True)
    requested_by: Mapped[str] = mapped_column(Text, nullable=False)
    approved_by: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    subject_type: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    subject_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    payload: Mapped[Optional[dict]] = mapped_column(JSONB, server_default="{}", nullable=False)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    risk_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    actor: Mapped[str] = mapped_column(Text, nullable=False)
    action: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    target_type: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    target_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    before: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    after: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    correlation_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    related_approval_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    metadata_: Mapped[Optional[dict]] = mapped_column("metadata", JSONB, server_default="{}", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)


class AutomationRule(Base, TimestampMixin):
    __tablename__ = "automation_rules"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, index=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    rule_type: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    conditions: Mapped[Optional[dict]] = mapped_column(JSONB, server_default="{}", nullable=False)
    scope: Mapped[Optional[dict]] = mapped_column(JSONB, server_default="{}", nullable=False)
    last_triggered_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    trigger_count: Mapped[int] = mapped_column(Integer, server_default="0", nullable=False)


class DriftEvent(Base):
    __tablename__ = "drift_events"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    miner_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, index=True)
    desired_state: Mapped[dict] = mapped_column(JSONB, nullable=False)
    actual_state: Mapped[dict] = mapped_column(JSONB, nullable=False)
    drift_fields: Mapped[list] = mapped_column(ARRAY(Text), nullable=False)
    severity: Mapped[str] = mapped_column(Text, server_default="warning", nullable=False)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution_action: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    related_approval_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)


class SubnetChange(Base):
    __tablename__ = "subnet_changes"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    change_type: Mapped[str] = mapped_column(Text, nullable=False)
    old_value: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    new_value: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    impact: Mapped[str] = mapped_column(Text, server_default="none", nullable=False)
    affected_miners: Mapped[Optional[list]] = mapped_column(ARRAY(UUID(as_uuid=False)), server_default="{}", nullable=False)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)
    source: Mapped[str] = mapped_column(Text, server_default="scanner", nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)


class SubnetVersion(Base):
    __tablename__ = "subnet_versions"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    version: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    requirements: Mapped[Optional[dict]] = mapped_column(JSONB, server_default="{}", nullable=False)
    miner_repo_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    commit_sha: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    docker_image: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)


class MinerVersion(Base):
    __tablename__ = "miner_versions"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    version: Mapped[str] = mapped_column(Text, nullable=False)
    repo_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    commit_sha: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    docker_image: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    release_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    min_cuda_version: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    min_vram_gb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    min_ram_gb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)


class ProfitabilitySnapshot(Base):
    __tablename__ = "profitability_snapshots"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default="uuid_generate_v4()")
    deployment_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, index=True)
    netuid: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    gross_revenue_tao: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    gross_revenue_alpha: Mapped[Optional[dict]] = mapped_column(JSONB, server_default="{}", nullable=False)
    gross_revenue_inr: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    gpu_cost_inr: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    net_profit_inr: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    roi_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    snapshot_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)
