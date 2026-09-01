"""
Tests for the deployment state machine.
"""
import pytest

from app.deployment.state_machine import (
    DeploymentState,
    assert_can_transition,
    can_transition,
)


@pytest.mark.parametrize(
    "from_state, to_state",
    [
        ("requested", "approved"),
        ("approved", "provisioning"),
        ("provisioning", "provisioned"),
        ("provisioned", "setup"),
        ("setup", "ready"),
        ("ready", "deploying"),
        ("deploying", "started"),
        ("started", "stopping"),
        ("stopping", "stopped"),
        ("stopped", "terminated"),
        ("requested", "failed"),
        ("failed", "terminated"),
        ("failed", "requested"),
    ],
)
def test_valid_transitions_are_allowed(from_state, to_state):
    assert can_transition(from_state, to_state) is True


@pytest.mark.parametrize(
    "from_state, to_state",
    [
        ("started", "provisioned"),
        ("terminated", "started"),
        ("stopped", "started"),
        ("ready", "stopped"),
    ],
)
def test_invalid_transitions_are_rejected(from_state, to_state):
    assert can_transition(from_state, to_state) is False


def test_assert_can_transition_returns_result():
    result = assert_can_transition("requested", "approved")
    assert result.allowed is True
    assert result.from_state == DeploymentState.REQUESTED
    assert result.to_state == DeploymentState.APPROVED


def test_assert_can_transition_rejects_invalid():
    result = assert_can_transition("started", "requested")
    assert result.allowed is False
    assert "Invalid transition" in (result.reason or "")


def test_terminated_has_no_outgoing_transitions():
    assert can_transition("terminated", "started") is False
    assert can_transition("terminated", "failed") is False
