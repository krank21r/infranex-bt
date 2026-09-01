"""
SQLAlchemy ORM models for Infranex BT.

All models map 1:1 to tables defined in:
  - `database/migrations/001_initial_schema.sql` (initial 27 tables)
  - `database/migrations/002_approval_audit_drift.sql` (Phase 1B: approval, audit, drift)
The SQL migrations are the source of truth; this file reflects them.
"""
from .audit import (
    ApprovalRequest,
    AuditLog,
    AutomationRule,
    DriftEvent,
    MinerVersion,
    ProfitabilitySnapshot,
    SubnetChange,
    SubnetVersion,
)
from .base import Base
from .compatibility import CompatibilityTest, TestResult
from .deployment import Deployment, Server
from .emission import Emission
from .gpu import GPUModel, GPUOffer, GPUProvider
from .incentive import Incentive
from .learning import AccuracyTracking, DriftAlert, PerformanceReport, WeightAdjustment
from .market_data import MarketData
from .miner import Miner, MinerHealth
from .neuron import Neuron, NeuronMetricsHistory
from .opportunity import OpportunityScore, ScoreComponent, UtilityAssessment
from .predictions import ActualResult, Prediction, PredictionAccuracy
from .repository import Repository, SubnetRequirement
from .rewards import Expense, Profitability, Reward
from .subnet import Subnet
from .subnet_metrics import SubnetMetrics, SubnetMetricsHistory
from .system_log import SystemLog
from .user import User

__all__ = [
    "AccuracyTracking",
    "ActualResult",
    "ApprovalRequest",
    "AuditLog",
    "AutomationRule",
    "Base",
    "CompatibilityTest",
    "Deployment",
    "DriftAlert",
    "DriftEvent",
    "Emission",
    "Expense",
    "GPUModel",
    "GPUOffer",
    "GPUProvider",
    "Incentive",
    "MarketData",
    "Miner",
    "MinerHealth",
    "MinerVersion",
    "Neuron",
    "NeuronMetricsHistory",
    "OpportunityScore",
    "PerformanceReport",
    "Prediction",
    "PredictionAccuracy",
    "Profitability",
    "ProfitabilitySnapshot",
    "Repository",
    "Reward",
    "ScoreComponent",
    "Server",
    "Subnet",
    "SubnetChange",
    "SubnetMetrics",
    "SubnetMetricsHistory",
    "SubnetRequirement",
    "SubnetVersion",
    "SystemLog",
    "TestResult",
    "User",
    "UtilityAssessment",
    "WeightAdjustment",
]
