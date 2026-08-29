"""
Deployment state machine.

States:
  requested -> approved -> provisioning -> provisioned -> setup
    -> ready -> deploying -> started -> stopping -> stopped -> terminated

Valid transitions with guards.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import FrozenSet, Optional


class DeploymentState(str, Enum):
    REQUESTED = "requested"
    APPROVED = "approved"
    PROVISIONING = "provisioning"
    PROVISIONED = "provisioned"
    SETUP = "setup"
    READY = "ready"
    DEPLOYING = "deploying"
    STARTED = "started"
    STOPPING = "stopping"
    STOPPED = "stopped"
    TERMINATED = "terminated"
    FAILED = "failed"


VALID_TRANSITIONS: dict[DeploymentState, FrozenSet[DeploymentState]] = {
    DeploymentState.REQUESTED: frozenset({
        DeploymentState.APPROVED,
        DeploymentState.FAILED,
        DeploymentState.TERMINATED,
    }),
    DeploymentState.APPROVED: frozenset({
        DeploymentState.PROVISIONING,
        DeploymentState.TERMINATED,
    }),
    DeploymentState.PROVISIONING: frozenset({
        DeploymentState.PROVISIONED,
        DeploymentState.FAILED,
        DeploymentState.TERMINATED,
    }),
    DeploymentState.PROVISIONED: frozenset({
        DeploymentState.SETUP,
        DeploymentState.TERMINATED,
    }),
    DeploymentState.SETUP: frozenset({
        DeploymentState.READY,
        DeploymentState.FAILED,
        DeploymentState.TERMINATED,
    }),
    DeploymentState.READY: frozenset({
        DeploymentState.DEPLOYING,
        DeploymentState.TERMINATED,
    }),
    DeploymentState.DEPLOYING: frozenset({
        DeploymentState.STARTED,
        DeploymentState.FAILED,
        DeploymentState.TERMINATED,
    }),
    DeploymentState.STARTED: frozenset({
        DeploymentState.STOPPING,
        DeploymentState.TERMINATED,
    }),
    DeploymentState.STOPPING: frozenset({
        DeploymentState.STOPPED,
        DeploymentState.FAILED,
    }),
    DeploymentState.STOPPED: frozenset({
        DeploymentState.TERMINATED,
    }),
    DeploymentState.FAILED: frozenset({
        DeploymentState.TERMINATED,
        DeploymentState.REQUESTED,
    }),
    DeploymentState.TERMINATED: frozenset(),
}


@dataclass(frozen=True)
class TransitionResult:
    allowed: bool
    from_state: DeploymentState
    to_state: DeploymentState
    reason: Optional[str] = None


def can_transition(from_state: str | DeploymentState, to_state: str | DeploymentState) -> bool:
    """Return True if the transition is valid in the state machine."""
    f = DeploymentState(from_state)
    t = DeploymentState(to_state)
    return t in VALID_TRANSITIONS.get(f, frozenset())


def assert_can_transition(from_state: str | DeploymentState, to_state: str | DeploymentState) -> TransitionResult:
    """Validate a transition and return a structured result."""
    f = DeploymentState(from_state)
    t = DeploymentState(to_state)
    if t in VALID_TRANSITIONS.get(f, frozenset()):
        return TransitionResult(allowed=True, from_state=f, to_state=t)
    return TransitionResult(
        allowed=False,
        from_state=f,
        to_state=t,
        reason=f"Invalid transition {f.value} -> {t.value}",
    )
