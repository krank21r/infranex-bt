from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any


@dataclass
class InstallationStep:
    name: str
    status: str = "pending"
    output: str = ""
    error: str = ""
    started_at: datetime | None = None
    completed_at: datetime | None = None
    duration_seconds: float | None = None

    def start(self) -> None:
        self.status = "running"
        self.started_at = datetime.now(UTC)

    def success(self, output: str = "") -> None:
        self.status = "success"
        self.output = output
        self.completed_at = datetime.now(UTC)
        if self.started_at:
            self.duration_seconds = (self.completed_at - self.started_at).total_seconds()

    def fail(self, error: str) -> None:
        self.status = "failed"
        self.error = error
        self.completed_at = datetime.now(UTC)
        if self.started_at:
            self.duration_seconds = (self.completed_at - self.started_at).total_seconds()


@dataclass
class InstallationResult:
    success: bool
    steps: list[InstallationStep] = field(default_factory=list)
    total_duration_seconds: float = 0.0
    error: str | None = None

    @property
    def completed_steps(self) -> int:
        return sum(1 for s in self.steps if s.status in ("success", "failed"))


@dataclass
class ServerSpec:
    provider: str
    offer_id: str
    gpu_model: str
    vram_gb: float
    region: str
    ssh_host: str
    ssh_port: int = 22
    ssh_user: str = "root"
    ssh_key: str | None = None


@dataclass
class MinerConfig:
    hotkey: str
    netuid: int
    wallet_path: str
    wallet_name: str
    custom_settings: dict[str, Any] = field(default_factory=dict)
