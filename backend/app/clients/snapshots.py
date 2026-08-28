"""
Snapshot DTOs — the wire format between `BittensorClient` and the ORM mappers.

Plain `@dataclass` so they:
- Don't drag SQLAlchemy into the client layer.
- Are trivially constructable in tests (no DB, no session).
- Are frozen so a snapshot can't be mutated mid-pipeline by accident.
"""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass(frozen=True)
class SubnetSnapshot:
    netuid: int
    name: Optional[str] = None
    description: Optional[str] = None
    owner_hotkey: Optional[str] = None
    max_neurons: Optional[int] = None
    max_allowed_validators: Optional[int] = None
    immunity_period: Optional[int] = None
    tempo: Optional[int] = None
    min_difficulty: Optional[int] = None
    max_difficulty: Optional[int] = None
    difficulty: Optional[int] = None
    rho: Optional[int] = None
    kappa: Optional[float] = None
    is_active: Optional[bool] = None
    registration_open: Optional[bool] = None
    raw_metadata: dict = field(default_factory=dict)


@dataclass(frozen=True)
class MetricsSnapshot:
    netuid: int
    block: Optional[int] = None
    miner_count: Optional[int] = None
    validator_count: Optional[int] = None
    emission: Optional[float] = None
    total_emission: Optional[float] = None
    average_incentive: Optional[float] = None
    median_incentive: Optional[float] = None
    top_incentive: Optional[float] = None
    total_incentive: Optional[float] = None
    total_stake: Optional[float] = None
    average_stake: Optional[float] = None
    trust: Optional[float] = None
    consensus: Optional[float] = None
    rank: Optional[float] = None
    registration_cost: Optional[float] = None
    neuron_utilization: Optional[float] = None
    top_5_concentration: Optional[float] = None
    top_10_concentration: Optional[float] = None
    miner_turnover: Optional[float] = None
    recorded_at: Optional[datetime] = None


@dataclass(frozen=True)
class NeuronSnapshot:
    netuid: int
    uid: int
    hotkey: str
    coldkey: Optional[str] = None
    stake: Optional[float] = None
    rank: Optional[float] = None
    trust: Optional[float] = None
    consensus: Optional[float] = None
    incentive: Optional[float] = None
    emission: Optional[float] = None
    dividends: Optional[float] = None
    active: Optional[bool] = None
    validator_permit: Optional[bool] = None
    last_update: Optional[int] = None
    recorded_at: Optional[datetime] = None


@dataclass(frozen=True)
class EmissionSnapshot:
    netuid: int
    block: Optional[int] = None
    emission_amount: Optional[float] = None
    subnet_emission: Optional[float] = None
    owner_emission: Optional[float] = None
    miner_emission: Optional[float] = None
    validator_emission: Optional[float] = None
    recorded_at: Optional[datetime] = None


@dataclass(frozen=True)
class IncentiveSnapshot:
    netuid: int
    uid: Optional[int] = None
    hotkey: Optional[str] = None
    incentive: Optional[float] = None
    emission: Optional[float] = None
    stake: Optional[float] = None
    block: Optional[int] = None
    recorded_at: Optional[datetime] = None
