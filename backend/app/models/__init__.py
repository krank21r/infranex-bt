"""
SQLAlchemy ORM models for Infranex BT.

All models map 1:1 to tables defined in:
  - `database/migrations/001_initial_schema.sql` (initial 27 tables)
  - `database/migrations/002_approval_audit_drift.sql` (Phase 1B: approval, audit, drift)
The SQL migrations are the source of truth; this file reflects them.
"""
from .base import Base
from .user import User
from .subnet import Subnet
from .subnet_metrics import SubnetMetrics, SubnetMetricsHistory
from .neuron import Neuron, NeuronMetricsHistory
from .emission import Emission
from .incentive import Incentive
from .market_data import MarketData
from .repository import Repository, SubnetRequirement
from .gpu import GPUModel, GPUProvider, GPUOffer
from .opportunity import OpportunityScore, ScoreComponent, UtilityAssessment
from .compatibility import CompatibilityTest, TestResult
from .deployment import Deployment, Server
from .miner import Miner, MinerHealth
from .rewards import Reward, Expense, Profitability
from .predictions import Prediction, ActualResult, PredictionAccuracy
from .system_log import SystemLog
from .learning import PerformanceReport, AccuracyTracking, WeightAdjustment, DriftAlert
from .audit import (
    ApprovalRequest,
    AuditLog,
    AutomationRule,
    DriftEvent,
    SubnetChange,
    SubnetVersion,
    MinerVersion,
    ProfitabilitySnapshot,
)

__all__ = [
    "Base",
    "User",
    "Subnet",
    "SubnetMetrics",
    "SubnetMetricsHistory",
    "Neuron",
    "NeuronMetricsHistory",
    "Emission",
    "Incentive",
    "MarketData",
    "Repository",
    "SubnetRequirement",
    "GPUModel",
    "GPUProvider",
    "GPUOffer",
    "OpportunityScore",
    "ScoreComponent",
    "UtilityAssessment",
    "CompatibilityTest",
    "TestResult",
    "Deployment",
    "Server",
    "Miner",
    "MinerHealth",
    "Reward",
    "Expense",
    "Profitability",
    "Prediction",
    "ActualResult",
    "PredictionAccuracy",
    "SystemLog",
    "ApprovalRequest",
    "AuditLog",
    "AutomationRule",
    "DriftEvent",
    "SubnetChange",
    "SubnetVersion",
    "MinerVersion",
    "ProfitabilitySnapshot",
    "PerformanceReport",
    "AccuracyTracking",
    "WeightAdjustment",
    "DriftAlert",
]
