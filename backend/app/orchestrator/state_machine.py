"""
Miner lifecycle state machine.
"""
from datetime import UTC, datetime
from enum import Enum
from typing import Any


class MinerState(str, Enum):
    IDLE = "idle"
    SCORING = "scoring"
    APPROVING = "approving"
    PROVISIONING = "provisioning"
    SETUP = "setup"
    DEPLOYING = "deploying"
    RUNNING = "running"
    MONITORING = "monitoring"
    OPTIMIZING = "optimizing"
    RECOVERING = "recovering"
    EXITING = "exiting"
    TERMINATED = "terminated"


VALID_TRANSITIONS = {
    MinerState.IDLE: {MinerState.SCORING},
    MinerState.SCORING: {MinerState.IDLE, MinerState.APPROVING},
    MinerState.APPROVING: {MinerState.IDLE, MinerState.PROVISIONING},
    MinerState.PROVISIONING: {MinerState.SETUP, MinerState.EXITING},
    MinerState.SETUP: {MinerState.DEPLOYING, MinerState.EXITING},
    MinerState.DEPLOYING: {MinerState.RUNNING, MinerState.EXITING},
    MinerState.RUNNING: {MinerState.MONITORING, MinerState.EXITING},
    MinerState.MONITORING: {
        MinerState.RUNNING,
        MinerState.OPTIMIZING,
        MinerState.RECOVERING,
        MinerState.EXITING,
    },
    MinerState.OPTIMIZING: {MinerState.RUNNING, MinerState.EXITING},
    MinerState.RECOVERING: {MinerState.RUNNING, MinerState.EXITING},
    MinerState.EXITING: {MinerState.TERMINATED, MinerState.IDLE},
    MinerState.TERMINATED: {MinerState.IDLE},
}


def can_transition(from_state: MinerState, to_state: MinerState) -> bool:
    return to_state in VALID_TRANSITIONS.get(from_state, set())


class MinerLifecycle:
    """Tracks the lifecycle state of a single miner."""

    def __init__(self, miner_id: str, netuid: int) -> None:
        self.miner_id = miner_id
        self.netuid = netuid
        self.state = MinerState.IDLE
        self.history: list[dict[str, Any]] = []

    def transition(self, to_state: MinerState, metadata: dict[str, Any] | None = None) -> None:
        if not can_transition(self.state, to_state):
            raise ValueError(
                f"Cannot transition miner {self.miner_id} from {self.state} to {to_state}"
            )
        entry = {
            "from": self.state.value,
            "to": to_state.value,
            "timestamp": datetime.now(UTC).isoformat(),
            "metadata": metadata or {},
        }
        self.history.append(entry)
        self.state = to_state

    def to_dict(self) -> dict[str, Any]:
        return {
            "miner_id": self.miner_id,
            "netuid": self.netuid,
            "state": self.state.value,
            "history": self.history,
        }
