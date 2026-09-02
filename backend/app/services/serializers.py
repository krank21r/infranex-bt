"""
ORM -> JSON-safe dict helpers.

Used by the cache write path (DiscoveryService after a successful
Postgres commit) and by the API read path when populating the cache
on a miss. Centralized here so the cache key/values stay consistent
across producers and consumers.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from app.models import Neuron, Subnet, SubnetMetrics


def _to_jsonable(value: Any) -> Any:
    """Recursively coerce ORM/datetime values into JSON-serializable types."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_to_jsonable(v) for v in value]
    return str(value)


def subnet_to_dict(s: Subnet) -> dict:
    """Serialize a Subnet ORM row into a JSON-safe dict for the cache."""
    return _to_jsonable({
        "id": s.id,
        "netuid": s.netuid,
        "name": s.name,
        "description": s.description,
        "subnet_type": s.subnet_type,
        "owner_hotkey": s.owner_hotkey,
        "max_neurons": s.max_neurons,
        "max_allowed_validators": s.max_allowed_validators,
        "immunity_period": s.immunity_period,
        "tempo": s.tempo,
        "min_difficulty": s.min_difficulty,
        "max_difficulty": s.max_difficulty,
        "difficulty": s.difficulty,
        "rho": s.rho,
        "kappa": s.kappa,
        "is_active": s.is_active,
        "registration_open": s.registration_open,
        "extra_metadata": s.extra_metadata,
        "created_at": s.created_at,
        "updated_at": s.updated_at,
    })


def metrics_to_dict(m: SubnetMetrics) -> dict:
    """Serialize a SubnetMetrics ORM row into a JSON-safe dict."""
    return _to_jsonable({
        "netuid": m.netuid,
        "block": m.block,
        "miner_count": m.miner_count,
        "validator_count": m.validator_count,
        "emission": m.emission,
        "total_emission": m.total_emission,
        "average_incentive": m.average_incentive,
        "median_incentive": m.median_incentive,
        "top_incentive": m.top_incentive,
        "total_incentive": m.total_incentive,
        "total_stake": m.total_stake,
        "average_stake": m.average_stake,
        "trust": m.trust,
        "consensus": m.consensus,
        "rank": m.rank,
        "registration_cost": m.registration_cost,
        "neuron_utilization": m.neuron_utilization,
        "top_5_concentration": m.top_5_concentration,
        "top_10_concentration": m.top_10_concentration,
        "miner_turnover": m.miner_turnover,
        "recorded_at": m.recorded_at,
        "data_source": m.data_source,
    })


def neuron_to_dict(n: Neuron) -> dict:
    """Serialize a Neuron ORM row into a JSON-safe dict."""
    return _to_jsonable({
        "netuid": n.netuid,
        "uid": n.uid,
        "hotkey": n.hotkey,
        "coldkey": n.coldkey,
        "stake": n.stake,
        "rank": n.rank,
        "trust": n.trust,
        "consensus": n.consensus,
        "incentive": n.incentive,
        "emission": n.emission,
        "dividends": n.dividends,
        "active": n.active,
        "validator_permit": n.validator_permit,
        "last_update": n.last_update,
        "recorded_at": n.recorded_at,
        "data_source": n.data_source,
    })
