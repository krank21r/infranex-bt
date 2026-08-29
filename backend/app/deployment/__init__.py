"""
Deployment module — state machine and setup automation for provisioning.
"""
from app.deployment.state_machine import (
    DeploymentState,
    VALID_TRANSITIONS,
    TransitionResult,
    can_transition,
    assert_can_transition,
)
from app.deployment.setup import (
    CompatibilityResult,
    validate_compatibility,
    generate_setup_script,
)

__all__ = [
    "DeploymentState",
    "VALID_TRANSITIONS",
    "TransitionResult",
    "can_transition",
    "assert_can_transition",
    "CompatibilityResult",
    "validate_compatibility",
    "generate_setup_script",
]
