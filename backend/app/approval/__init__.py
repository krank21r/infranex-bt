"""
Approval module — L1/L2/L3 action gating, audit log writer, and approval router.

The approval module is the capital-protection layer of Infranex BT.

Three pillars:
  1. 3-level approval system (L1_auto / L2_confirm / L3_mandatory) — every
     consequential action must be classified before it executes.
  2. Audit log — what Infranex detected, why, what the user approved,
     what changed on the server.
  3. Drift detection (handled by a separate module) feeds into this one
     by surfacing drift_events that need approval.

Data lives in the 8 tables created by migration 002:
  approval_requests, audit_logs, automation_rules, drift_events,
  subnet_changes, subnet_versions, miner_versions, profitability_snapshots.

Architecture reference: memory/project-architecture-spec.md
"""
from .classifier import (
    ActionContext,
    ActionLevel,
    classify_action,
    AUTO_TRIGGER_ACTIONS,
    CONFIRM_TRIGGER_ACTIONS,
    MANDATORY_TRIGGER_ACTIONS,
)
from .service import ApprovalService
from .audit import AuditWriter
from .router import ApprovalRouter, ApprovalResult

__all__ = [
    "ActionContext",
    "ActionLevel",
    "classify_action",
    "AUTO_TRIGGER_ACTIONS",
    "CONFIRM_TRIGGER_ACTIONS",
    "MANDATORY_TRIGGER_ACTIONS",
    "ApprovalService",
    "AuditWriter",
    "ApprovalRouter",
    "ApprovalResult",
]
