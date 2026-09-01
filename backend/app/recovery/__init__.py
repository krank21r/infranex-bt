"""
Recovery module — health checks, recovery strategies, and the RecoveryEngine.

Architecture:
  - `health_checker.py`  : pure functions that inspect raw miner state and
                           return a structured `HealthSignal`.
  - `strategies.py`      : pure strategy functions. Each takes a
                           `RecoveryAction` and returns a `RecoveryResult`.
                           No DB writes — the caller persists outcomes.
  - `recovery.py`         : `HealthSignal` and `RecoveryAction` dataclasses,
                           plus the `RecoveryEngine` class (reads DB, no writes).
"""
from app.recovery.health_checker import (
    HealthChecker,
    HealthSignal,
    aggregate_health_signal,
)
from app.recovery.recovery import (
    RecoveryAction,
    RecoveryEngine,
    RecoveryResult,
)
from app.recovery.strategies import (
    escalate_to_human,
    redeploy,
    restart_process,
    switch_subnet,
)

__all__ = [
    "HealthChecker",
    "HealthSignal",
    "RecoveryAction",
    "RecoveryEngine",
    "RecoveryResult",
    "aggregate_health_signal",
    "escalate_to_human",
    "redeploy",
    "restart_process",
    "switch_subnet",
]
