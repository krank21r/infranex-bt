"""
Snapshot -> ORM row mappers.

Pure functions: take a snapshot DTO and a data_source string, return an
unsaved ORM row. The caller (DiscoveryService) is responsible for adding,
committing, and refreshing.

Keeping these in one place means the snapshot shape and the ORM shape can
diverge (raw SDK payloads nest differently than our flat ORM) without
spreading conversion code across the codebase.
"""
from app.clients.snapshots import (
    EmissionSnapshot,
    IncentiveSnapshot,
    MetricsSnapshot,
    NeuronSnapshot,
    SubnetSnapshot,
)
from app.models import Emission, Incentive, Neuron, SubnetMetrics


def subnet_from_snapshot(snap: SubnetSnapshot, data_source: str) -> dict:
    """Return the kwarg dict for `SubnetService.upsert`.

    Returns a dict (not a Subnet instance) so the caller can hand it
    straight to `upsert(netuid=..., **fields)` — the service handles
    insert vs update. The raw SDK payload is stashed in `extra_metadata`
    so future audits can see what the chain reported, not just what we
    decided to persist.
    """
    return {
        "name": snap.name,
        "description": snap.description,
        "owner_hotkey": snap.owner_hotkey,
        "max_neurons": snap.max_neurons,
        "max_allowed_validators": snap.max_allowed_validators,
        "immunity_period": snap.immunity_period,
        "tempo": snap.tempo,
        "min_difficulty": snap.min_difficulty,
        "max_difficulty": snap.max_difficulty,
        "difficulty": snap.difficulty,
        "rho": snap.rho,
        "kappa": snap.kappa,
        "is_active": snap.is_active,
        "registration_open": snap.registration_open,
        "extra_metadata": {**(snap.raw_metadata or {}), "data_source": data_source},
    }


def metrics_from_snapshot(snap: MetricsSnapshot, data_source: str) -> SubnetMetrics:
    return SubnetMetrics(
        netuid=snap.netuid,
        block=snap.block,
        miner_count=snap.miner_count,
        validator_count=snap.validator_count,
        emission=snap.emission,
        total_emission=snap.total_emission,
        average_incentive=snap.average_incentive,
        median_incentive=snap.median_incentive,
        top_incentive=snap.top_incentive,
        total_incentive=snap.total_incentive,
        total_stake=snap.total_stake,
        average_stake=snap.average_stake,
        trust=snap.trust,
        consensus=snap.consensus,
        rank=snap.rank,
        registration_cost=snap.registration_cost,
        neuron_utilization=snap.neuron_utilization,
        top_5_concentration=snap.top_5_concentration,
        top_10_concentration=snap.top_10_concentration,
        miner_turnover=snap.miner_turnover,
        data_source=data_source,
        recorded_at=snap.recorded_at,
    )


def neuron_from_snapshot(snap: NeuronSnapshot, data_source: str) -> Neuron:
    return Neuron(
        netuid=snap.netuid,
        uid=snap.uid,
        hotkey=snap.hotkey,
        coldkey=snap.coldkey,
        stake=snap.stake,
        rank=snap.rank,
        trust=snap.trust,
        consensus=snap.consensus,
        incentive=snap.incentive,
        emission=snap.emission,
        dividends=snap.dividends,
        active=snap.active,
        validator_permit=snap.validator_permit,
        last_update=snap.last_update,
        data_source=data_source,
    )


def emission_from_snapshot(snap: EmissionSnapshot, data_source: str) -> Emission:
    return Emission(
        netuid=snap.netuid,
        block=snap.block,
        emission_amount=snap.emission_amount,
        subnet_emission=snap.subnet_emission,
        owner_emission=snap.owner_emission,
        miner_emission=snap.miner_emission,
        validator_emission=snap.validator_emission,
        data_source=data_source,
    )


def incentive_from_snapshot(snap: IncentiveSnapshot, data_source: str) -> Incentive:
    return Incentive(
        netuid=snap.netuid,
        uid=snap.uid,
        hotkey=snap.hotkey,
        incentive=snap.incentive,
        emission=snap.emission,
        stake=snap.stake,
        block=snap.block,
        data_source=data_source,
    )
