"""
Learning Engine — closed-loop scoring feedback for Infranex BT.

Aggregates actual mining performance, tracks prediction accuracy,
detects model drift, and proposes bounded weight adjustments to
the opportunity scoring engine.

Modules:
  aggregator — PerformanceAggregator: miner + subnet performance reports
  tracker    — AccuracyTracker: predicted vs actual ROI, model accuracy
  adapter    — WeightAdapter: bounded weight adjustment proposals
  feedback   — FeedbackLoop: periodic end-to-end learning cycle
"""
from app.learning.aggregator import PerformanceAggregator
from app.learning.tracker import AccuracyTracker
from app.learning.adapter import WeightAdapter
from app.learning.feedback import FeedbackLoop

__all__ = [
    "PerformanceAggregator",
    "AccuracyTracker",
    "WeightAdapter",
    "FeedbackLoop",
]
