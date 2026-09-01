"""
Snapshot DTOs — the wire format between `BittensorClient` and the ORM mappers.

Plain `@dataclass` so they:
- Don't drag SQLAlchemy into the client layer.
- Are trivially constructable in tests (no DB, no session).
- Are frozen so a snapshot can't be mutated mid-pipeline by accident.
"""
from dataclasses import dataclass, field
from datetime import datetime


@dataclass(frozen=True)
class SubnetSnapshot:
    netuid: int
    name: str | None = None
    description: str | None = None
    owner_hotkey: str | None = None
    max_neurons: int | None = None
    max_allowed_validators: int | None = None
    immunity_period: int | None = None
    tempo: int | None = None
    min_difficulty: int | None = None
    max_difficulty: int | None = None
    difficulty: int | None = None
    rho: int | None = None
    kappa: float | None = None
    is_active: bool | None = None
    registration_open: bool | None = None
    raw_metadata: dict = field(default_factory=dict)


@dataclass(frozen=True)
class MetricsSnapshot:
    netuid: int
    block: int | None = None
    miner_count: int | None = None
    validator_count: int | None = None
    emission: float | None = None
    total_emission: float | None = None
    average_incentive: float | None = None
    median_incentive: float | None = None
    top_incentive: float | None = None
    total_incentive: float | None = None
    total_stake: float | None = None
    average_stake: float | None = None
    trust: float | None = None
    consensus: float | None = None
    rank: float | None = None
    registration_cost: float | None = None
    neuron_utilization: float | None = None
    top_5_concentration: float | None = None
    top_10_concentration: float | None = None
    miner_turnover: float | None = None
    recorded_at: datetime | None = None


@dataclass(frozen=True)
class NeuronSnapshot:
    netuid: int
    uid: int
    hotkey: str
    coldkey: str | None = None
    stake: float | None = None
    rank: float | None = None
    trust: float | None = None
    consensus: float | None = None
    incentive: float | None = None
    emission: float | None = None
    dividends: float | None = None
    active: bool | None = None
    validator_permit: bool | None = None
    last_update: int | None = None
    recorded_at: datetime | None = None


@dataclass(frozen=True)
class EmissionSnapshot:
    netuid: int
    block: int | None = None
    emission_amount: float | None = None
    subnet_emission: float | None = None
    owner_emission: float | None = None
    miner_emission: float | None = None
    validator_emission: float | None = None
    recorded_at: datetime | None = None


@dataclass(frozen=True)
class IncentiveSnapshot:
    netuid: int
    uid: int | None = None
    hotkey: str | None = None
    incentive: float | None = None
    emission: float | None = None
    stake: float | None = None
    block: int | None = None
    recorded_at: datetime | None = None
