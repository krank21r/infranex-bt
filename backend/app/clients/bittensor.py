"""
Bittensor chain client.
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Callable, List, Optional, Tuple

from app.clients.snapshots import (
    EmissionSnapshot,
    IncentiveSnapshot,
    MetricsSnapshot,
    NeuronSnapshot,
    SubnetSnapshot,
)
from app.core.config import settings

logger = logging.getLogger(__name__)

_client: Optional["BittensorClient"] = None


class BittensorClient(ABC):
    """Narrow async surface the discovery service depends on."""

    @abstractmethod
    async def get_subnets(self) -> List[SubnetSnapshot]:
        pass

    @abstractmethod
    async def get_metagraph(self, netuid: int) -> Tuple[MetricsSnapshot, List[NeuronSnapshot]]:
        pass

    @abstractmethod
    async def get_emissions(self, netuid: int, block_range: int) -> List[EmissionSnapshot]:
        pass

    @abstractmethod
    async def get_incentives(self, netuid: int, block_range: int) -> List[IncentiveSnapshot]:
        pass


class RealBittensorClient(BittensorClient):
    def __init__(self) -> None:
        try:
            import bittensor as bt
        except ImportError as e:
            raise ImportError(
                "RealBittensorClient requires the `bittensor` package."
            ) from e
        self._network = settings.BITTENSOR_NETWORK
        self._endpoint = settings.BITTENSOR_RPC_ENDPOINT
        logger.info("real_bittensor_client_init", network=self._network, endpoint=self._endpoint)

    async def get_subnets(self) -> List[SubnetSnapshot]:
        logger.warning("real_bittensor_get_subnets_not_wired")
        return []

    async def get_metagraph(self, netuid: int) -> Tuple[MetricsSnapshot, List[NeuronSnapshot]]:
        logger.warning("real_bittensor_get_metagraph_not_wired", netuid=netuid)
        return MetricsSnapshot(netuid=netuid), []

    async def get_emissions(self, netuid: int, block_range: int) -> List[EmissionSnapshot]:
        logger.warning("real_bittensor_get_emissions_not_wired", netuid=netuid, block_range=block_range)
        return []

    async def get_incentives(self, netuid: int, block_range: int) -> List[IncentiveSnapshot]:
        logger.warning("real_bittensor_get_incentives_not_wired", netuid=netuid, block_range=block_range)
        return []


class FakeBittensorClient(BittensorClient):
    _FAKE_NETUIDS: Tuple[int, ...] = (1, 3, 64)
    _FAKE_NAMES = {
        1: ("fake-text", "Synthetic text generation subnet"),
        3: ("fake-vision", "Synthetic image classification subnet"),
        64: ("fake-finetune", "Synthetic model fine-tuning subnet"),
    }
    _NEURONS_PER_SUBNET = 5

    def __init__(self, _now: Optional[Callable[[], datetime]] = None) -> None:
        self._now = _now or (lambda: datetime.now(timezone.utc))

    async def get_subnets(self) -> List[SubnetSnapshot]:
        now = self._now()
        out: List[SubnetSnapshot] = []
        for netuid in self._FAKE_NETUIDS:
            name, desc = self._FAKE_NAMES[netuid]
            out.append(SubnetSnapshot(
                netuid=netuid,
                name=name,
                description=desc,
                owner_hotkey=f"5FakeOwnerHotkey{netuid:04d}aaaaaaaaaaaaaaaaaa",
                max_neurons=256,
                max_allowed_validators=64,
                immunity_period=4096,
                tempo=360,
                min_difficulty=10_000_000,
                max_difficulty=1_000_000_000,
                difficulty=100_000_000,
                rho=10,
                kappa=0.5,
                is_active=True,
                registration_open=True,
                raw_metadata={"source": "fake", "seeded_at": now.isoformat()},
            ))
        return out

    async def get_metagraph(self, netuid: int) -> Tuple[MetricsSnapshot, List[NeuronSnapshot]]:
        now = self._now()
        metrics = MetricsSnapshot(
            netuid=netuid,
            block=1_000_000 + netuid,
            miner_count=self._NEURONS_PER_SUBNET,
            validator_count=max(1, self._NEURONS_PER_SUBNET // 5),
            emission=1.0 / netuid,
            total_emission=1.0,
            average_incentive=0.5,
            median_incentive=0.5,
            top_incentive=1.0,
            total_incentive=0.5 * self._NEURONS_PER_SUBNET,
            total_stake=10_000.0 * netuid,
            average_stake=2_000.0,
            trust=0.9,
            consensus=0.85,
            rank=netuid * 0.01,
            registration_cost=0.1,
            neuron_utilization=0.7,
            top_5_concentration=0.6,
            top_10_concentration=0.8,
            miner_turnover=0.05,
            recorded_at=now,
        )
        neurons = [
            NeuronSnapshot(
                netuid=netuid,
                uid=uid,
                hotkey=f"5FakeNeuronHotkey{netuid:03d}{uid:03d}aaaaaaaaaaaaaaaa",
                coldkey=f"5FakeColdkey{netuid:03d}{uid:03d}bbbbbbbbbbbbbbbbbb",
                stake=1_000.0 * (uid + 1),
                rank=uid * 0.1,
                trust=0.5 + uid * 0.05,
                consensus=0.4 + uid * 0.05,
                incentive=0.1 + uid * 0.05,
                emission=0.1 + uid * 0.05,
                dividends=0.05 + uid * 0.01,
                active=True,
                validator_permit=(uid == 0),
                last_update=1_000_000 + netuid * 100 + uid,
                recorded_at=now,
            )
            for uid in range(self._NEURONS_PER_SUBNET)
        ]
        return metrics, neurons

    async def get_emissions(self, netuid: int, block_range: int) -> List[EmissionSnapshot]:
        now = self._now()
        return [
            EmissionSnapshot(
                netuid=netuid,
                block=1_000_000 - offset,
                emission_amount=1.0 / netuid,
                subnet_emission=0.8 / netuid,
                owner_emission=0.1 / netuid,
                miner_emission=0.08 / netuid,
                validator_emission=0.02 / netuid,
                recorded_at=now,
            )
            for offset in (0, 1)
        ]

    async def get_incentives(self, netuid: int, block_range: int) -> List[IncentiveSnapshot]:
        now = self._now()
        return [
            IncentiveSnapshot(
                netuid=netuid,
                uid=uid,
                hotkey=f"5FakeNeuronHotkey{netuid:03d}{uid:03d}aaaaaaaaaaaaaaaa",
                incentive=0.1 + uid * 0.05,
                emission=0.1 + uid * 0.05,
                stake=1_000.0 * (uid + 1),
                block=1_000_000 - offset,
                recorded_at=now,
            )
            for offset in (0, 1)
            for uid in range(self._NEURONS_PER_SUBNET)
        ]


def get_bittensor_client(reset: bool = False) -> BittensorClient:
    global _client
    if reset:
        _client = None
    if _client is not None:
        return _client
    if settings.DEPLOYMENT_MODE == "production":
        _client = RealBittensorClient()
    else:
        _client = FakeBittensorClient()
    logger.info("bittensor_client_selected", mode=settings.DEPLOYMENT_MODE, type=type(_client).__name__)
    return _client
