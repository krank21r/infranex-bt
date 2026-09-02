"""
Bittensor chain client.
"""
from __future__ import annotations

import asyncio
import logging
from abc import ABC, abstractmethod
from collections.abc import Callable
from datetime import UTC, datetime
from app.clients.snapshots import (
    EmissionSnapshot,
    IncentiveSnapshot,
    MetricsSnapshot,
    NeuronSnapshot,
    SubnetSnapshot,
)
from app.core.config import settings

_BITTENSOR_SDK_CONCURRENCY = 8  # cap concurrent in-flight RPCs
_BITTENSOR_SDK_TIMEOUT_SECONDS = 30.0
from app.clients.snapshots import (
    EmissionSnapshot,
    IncentiveSnapshot,
    MetricsSnapshot,
    NeuronSnapshot,
    SubnetSnapshot,
)
from app.core.config import settings

logger = logging.getLogger(__name__)

_client: BittensorClient | None = None


class BittensorClient(ABC):
    """Narrow async surface the discovery service depends on."""

    @abstractmethod
    async def get_subnets(self) -> list[SubnetSnapshot]:
        pass

    @abstractmethod
    async def get_metagraph(self, netuid: int) -> tuple[MetricsSnapshot, list[NeuronSnapshot]]:
        pass

    @abstractmethod
    async def get_emissions(self, netuid: int, block_range: int) -> list[EmissionSnapshot]:
        pass

    @abstractmethod
    async def get_incentives(self, netuid: int, block_range: int) -> list[IncentiveSnapshot]:
        pass


class RealBittensorClient(BittensorClient):
    """
    Real Bittensor chain client using the bittensor SDK.
    
    Connects to a subtensor RPC endpoint and fetches live chain data.
    All methods run SDK calls in a thread pool to avoid blocking the event loop.
    """

    def __init__(self) -> None:
        try:
            import bittensor as bt
        except ImportError as e:
            raise ImportError(
                "RealBittensorClient requires the `bittensor` package (>=9.0.0). "
                "Install with: pip install bittensor>=9.0.0"
            ) from e

        self._network = settings.BITTENSOR_NETWORK
        self._endpoint = settings.BITTENSOR_RPC_ENDPOINT
        self._bt = bt
        self._subtensor: bt.Subtensor | None = None

        self._subtensor_lock = asyncio.Lock()
        self._call_sem = asyncio.Semaphore(_BITTENSOR_SDK_CONCURRENCY)

        logger.info("real_bittensor_client_init", network=self._network, endpoint=self._endpoint)

    async def _get_subtensor(self) -> bt.Subtensor:
        """Get or create the subtensor connection (thread-safe)."""
        if self._subtensor is None:
            async with self._subtensor_lock:
                if self._subtensor is None:
                    # Run in thread pool since bittensor SDK is synchronous
                    self._subtensor = await asyncio.get_event_loop().run_in_executor(
                        None,
                        lambda: self._bt.Subtensor(network=self._network)
                    )
                    logger.info("subtensor_connected", network=self._network)
        return self._subtensor

    async def _run_sdk(self, fn, *args, **kwargs):
        """Run a synchronous bittensor SDK call with concurrency cap,
        timeout, and tenacity-backed retry on transient errors.

        The semaphore prevents the worker from saturating the
        subtensor RPC endpoint with one call per netuid concurrently
        (get_metagraph + get_emissions + get_incentives all want to
        fire at once during a full scan). Retries cover transient
        network / RPC errors; permanent errors (programmer bugs)
        re-raise immediately.
        """
        from tenacity import (
            AsyncRetrying,
            retry_if_exception_type,
            stop_after_attempt,
            wait_exponential,
        )

        async with self._call_sem:
            async for attempt in AsyncRetrying(
                stop=stop_after_attempt(3),
                wait=wait_exponential(multiplier=1, min=1, max=10),
                retry=retry_if_exception_type((TimeoutError, ConnectionError, OSError)),
                reraise=True,
            ):
                with attempt:
                    return await asyncio.wait_for(
                        asyncio.get_event_loop().run_in_executor(
                            None, lambda: fn(*args, **kwargs)
                        ),
                        timeout=_BITTENSOR_SDK_TIMEOUT_SECONDS,
                    )

    async def get_subnets(self) -> list[SubnetSnapshot]:
        """Fetch all active subnets from the chain."""
        try:
            subtensor = await self._get_subtensor()

            # Get all subnet netuids by querying the chain
            # Use metagraph to discover subnets, or query subnets directly
            subnets_data = await self._run_sdk(subtensor.all_subnets)

            now = datetime.now(UTC)
            snapshots: list[SubnetSnapshot] = []

            for netuid in subnets_data:
                try:
                    # Fetch subnet info for each netuid
                    subnet_info = await self._run_sdk(subtensor.get_subnet_hyperparameters, n)

                    if subnet_info is None:
                        continue

                    # Get subnet name from metagraph or use netuid
                    subnet_name = await self._get_subnet_name(subtensor, netuid)

                    snapshots.append(SubnetSnapshot(
                        netuid=netuid,
                        name=subnet_name,
                        description=None,  # Not directly available from chain
                        owner_hotkey=getattr(subnet_info, 'owner_hotkey', None),
                        max_neurons=getattr(subnet_info, 'max_neurons', None),
                        max_allowed_validators=getattr(subnet_info, 'max_allowed_validators', None),
                        immunity_period=getattr(subnet_info, 'immunity_period', None),
                        tempo=getattr(subnet_info, 'tempo', None),
                        min_difficulty=getattr(subnet_info, 'min_difficulty', None),
                        max_difficulty=getattr(subnet_info, 'max_difficulty', None),
                        difficulty=getattr(subnet_info, 'difficulty', None),
                        rho=getattr(subnet_info, 'rho', None),
                        kappa=getattr(subnet_info, 'kappa', None),
                        is_active=True,
                        registration_open=getattr(subnet_info, 'registration_allowed', True),
                        raw_metadata={"source": "bittensor_sdk", "fetched_at": now.isoformat()},
                    ))
                except Exception as e:
                    logger.warning("failed_to_fetch_subnet", netuid=netuid, error=str(e))
                    continue

            logger.info("real_bittensor_get_subnets_done", count=len(snapshots))
            return snapshots

        except Exception as e:
            logger.error("real_bittensor_get_subnets_failed", error=str(e))
            return []

    async def _get_subnet_name(self, subtensor, netuid: int) -> str | None:
        """Try to get subnet name from metagraph or registry."""
        try:
            # Try to get from metagraph
            metagraph = await self._run_sdk(subtensor.metagraph, netuid)
            if metagraph and hasattr(metagraph, 'name') and metagraph.name:
                return metagraph.name
        except Exception:
            pass
        return f"subnet-{netuid}"

    async def get_metagraph(self, netuid: int) -> tuple[MetricsSnapshot, list[NeuronSnapshot]]:
        """Fetch metagraph for a subnet: metrics + all neurons."""
        try:
            subtensor = await self._get_subtensor()

            # Fetch metagraph
            metagraph = await self._run_sdk(subtensor.metagraph, netuid)


            if metagraph is None:
                logger.warning("metagraph_not_found", netuid=netuid)
                return MetricsSnapshot(netuid=netuid), []

            now = datetime.now(UTC)
            block = getattr(metagraph, 'block', None)

            # Extract metrics from metagraph
            n = metagraph.n.item() if hasattr(metagraph.n, 'item') else len(metagraph.hotkeys)
            validator_count = sum(1 for v in metagraph.validator_permit if v) if hasattr(metagraph, 'validator_permit') else 0
            miner_count = n - validator_count

            # Calculate aggregate metrics
            total_incentive = float(sum(metagraph.I)) if hasattr(metagraph, 'I') else 0.0
            avg_incentive = total_incentive / n if n > 0 else 0.0

            # Incentive distribution
            incentives = [float(i) for i in metagraph.I] if hasattr(metagraph, 'I') else []
            top_incentive = max(incentives) if incentives else 0.0
            median_incentive = sorted(incentives)[len(incentives)//2] if incentives else 0.0

            # Stake distribution for concentration
            stakes = [float(s) for s in metagraph.S] if hasattr(metagraph, 'S') else []
            total_stake_val = sum(stakes)
            sorted_stakes = sorted(stakes, reverse=True)
            top_5_concentration = sum(sorted_stakes[:5]) / total_stake_val if total_stake_val > 0 and len(sorted_stakes) >= 5 else 0.0
            top_10_concentration = sum(sorted_stakes[:10]) / total_stake_val if total_stake_val > 0 and len(sorted_stakes) >= 10 else 0.0

            # Network health metrics
            trust_vals = [float(t) for t in metagraph.T] if hasattr(metagraph, 'T') else []
            consensus_vals = [float(c) for c in metagraph.C] if hasattr(metagraph, 'C') else []
            ranks = [float(r) for r in metagraph.R] if hasattr(metagraph, 'R') else []

            avg_trust = sum(trust_vals) / len(trust_vals) if trust_vals else 0.0
            avg_consensus = sum(consensus_vals) / len(consensus_vals) if consensus_vals else 0.0
            avg_rank = sum(ranks) / len(ranks) if ranks else 0.0

            # Emission (approximate from incentive * total emission)
            emission = getattr(metagraph, 'emission', None)
            if emission is not None:
                emission = float(emission)
            else:
                emission = avg_incentive  # Fallback

            # Neuron utilization (active neurons / max)
            active_count = sum(1 for a in metagraph.active if a) if hasattr(metagraph, 'active') else n
            neuron_utilization = active_count / n if n > 0 else 0.0

            # Miner turnover (placeholder - would need historical data)
            miner_turnover = 0.0

            # Registration cost
            registration_cost = getattr(metagraph, 'registration_cost', 0.0)
            if hasattr(registration_cost, 'item'):
                registration_cost = registration_cost.item()
            registration_cost = float(registration_cost) if registration_cost else 0.0

            metrics = MetricsSnapshot(
                netuid=netuid,
                block=block,
                miner_count=miner_count,
                validator_count=validator_count,
                emission=emission,
                total_emission=emission * n if emission else 0.0,
                average_incentive=avg_incentive,
                median_incentive=median_incentive,
                top_incentive=top_incentive,
                total_incentive=total_incentive,
                total_stake=total_stake_val,
                average_stake=total_stake_val / n if n > 0 else 0.0,
                trust=avg_trust,
                consensus=avg_consensus,
                rank=avg_rank,
                registration_cost=registration_cost,
                neuron_utilization=neuron_utilization,
                top_5_concentration=top_5_concentration,
                top_10_concentration=top_10_concentration,
                miner_turnover=miner_turnover,
                recorded_at=now,
            )

            # Build neuron snapshots
            neurons: list[NeuronSnapshot] = []
            hotkeys = metagraph.hotkeys if hasattr(metagraph, 'hotkeys') else []
            coldkeys = metagraph.coldkeys if hasattr(metagraph, 'coldkeys') else []
            stakes_arr = metagraph.S if hasattr(metagraph, 'S') else []
            ranks_arr = metagraph.R if hasattr(metagraph, 'R') else []
            trust_arr = metagraph.T if hasattr(metagraph, 'T') else []
            consensus_arr = metagraph.C if hasattr(metagraph, 'C') else []
            incentives_arr = metagraph.I if hasattr(metagraph, 'I') else []
            emissions_arr = metagraph.E if hasattr(metagraph, 'E') else []
            dividends_arr = metagraph.D if hasattr(metagraph, 'D') else []
            active_arr = metagraph.active if hasattr(metagraph, 'active') else []
            validator_permit_arr = metagraph.validator_permit if hasattr(metagraph, 'validator_permit') else []
            last_update_arr = metagraph.last_update if hasattr(metagraph, 'last_update') else []

            for uid in range(n):
                try:
                    neurons.append(NeuronSnapshot(
                        netuid=netuid,
                        uid=uid,
                        hotkey=str(hotkeys[uid]) if uid < len(hotkeys) else "",
                        coldkey=str(coldkeys[uid]) if uid < len(coldkeys) else None,
                        stake=float(stakes_arr[uid]) if uid < len(stakes_arr) else 0.0,
                        rank=float(ranks_arr[uid]) if uid < len(ranks_arr) else 0.0,
                        trust=float(trust_arr[uid]) if uid < len(trust_arr) else 0.0,
                        consensus=float(consensus_arr[uid]) if uid < len(consensus_arr) else 0.0,
                        incentive=float(incentives_arr[uid]) if uid < len(incentives_arr) else 0.0,
                        emission=float(emissions_arr[uid]) if uid < len(emissions_arr) else 0.0,
                        dividends=float(dividends_arr[uid]) if uid < len(dividends_arr) else 0.0,
                        active=bool(active_arr[uid]) if uid < len(active_arr) else True,
                        validator_permit=bool(validator_permit_arr[uid]) if uid < len(validator_permit_arr) else False,
                        last_update=int(last_update_arr[uid]) if uid < len(last_update_arr) else block,
                        recorded_at=now,
                    ))
                except Exception as e:
                    logger.warning("failed_to_parse_neuron", netuid=netuid, uid=uid, error=str(e))
                    continue

            logger.info("real_bittensor_get_metagraph_done", netuid=netuid, neurons=len(neurons))
            return metrics, neurons

        except Exception as e:
            logger.error("real_bittensor_get_metagraph_failed", netuid=netuid, error=str(e))
            return MetricsSnapshot(netuid=netuid), []

    async def get_emissions(self, netuid: int, block_range: int) -> list[EmissionSnapshot]:
        """Fetch emission history for a subnet."""
        try:
            subtensor = await self._get_subtensor()

            # Get current block
            current_block = await self._run_sdk(subtensor.get_current_block)

            start_block = current_block - block_range
            snapshots: list[EmissionSnapshot] = []
            now = datetime.now(UTC)

            # Fetch emissions for blocks in range (sample every 100 blocks to avoid too many calls)
            step = max(1, block_range // 100)
            for block in range(start_block, current_block + 1, step):
                try:
                    emission_data = await self._run_sdk(subtensor.get_emission_by_block, netuid, b)

                    if emission_data:
                        snapshots.append(EmissionSnapshot(
                            netuid=netuid,
                            block=block,
                            emission_amount=float(emission_data.get('emission', 0)),
                            subnet_emission=float(emission_data.get('subnet_emission', 0)),
                            owner_emission=float(emission_data.get('owner_emission', 0)),
                            miner_emission=float(emission_data.get('miner_emission', 0)),
                            validator_emission=float(emission_data.get('validator_emission', 0)),
                            recorded_at=now,
                        ))
                except Exception as e:
                    logger.debug("emission_fetch_failed", netuid=netuid, block=block, error=str(e))
                    continue

            logger.info("real_bittensor_get_emissions_done", netuid=netuid, count=len(snapshots))
            return snapshots

        except Exception as e:
            logger.error("real_bittensor_get_emissions_failed", netuid=netuid, error=str(e))
            return []

    async def get_incentives(self, netuid: int, block_range: int) -> list[IncentiveSnapshot]:
        """Fetch incentive history for a subnet."""
        try:
            subtensor = await self._get_subtensor()

            current_block = await self._run_sdk(subtensor.get_current_block)

            start_block = current_block - block_range
            snapshots: list[IncentiveSnapshot] = []
            now = datetime.now(UTC)

            # Sample every 100 blocks
            step = max(1, block_range // 100)
            for block in range(start_block, current_block + 1, step):
                try:
                    # Get metagraph at specific block
                    metagraph = await self._run_sdk(subtensor.metagraph, netuid, block=b)

                    if metagraph and hasattr(metagraph, 'I') and hasattr(metagraph, 'hotkeys'):
                        incentives = [float(i) for i in metagraph.I]
                        hotkeys = [str(h) for h in metagraph.hotkeys]
                        stakes = [float(s) for s in metagraph.S] if hasattr(metagraph, 'S') else []
                        emissions = [float(e) for e in metagraph.E] if hasattr(metagraph, 'E') else []

                        for uid, (incentive, hotkey) in enumerate(zip(incentives, hotkeys)):
                            snapshots.append(IncentiveSnapshot(
                                netuid=netuid,
                                uid=uid,
                                hotkey=hotkey,
                                incentive=incentive,
                                emission=emissions[uid] if uid < len(emissions) else 0.0,
                                stake=stakes[uid] if uid < len(stakes) else 0.0,
                                block=block,
                                recorded_at=now,
                            ))
                except Exception as e:
                    logger.debug("incentive_fetch_failed", netuid=netuid, block=block, error=str(e))
                    continue

            logger.info("real_bittensor_get_incentives_done", netuid=netuid, count=len(snapshots))
            return snapshots

        except Exception as e:
            logger.error("real_bittensor_get_incentives_failed", netuid=netuid, error=str(e))
            return []


class FakeBittensorClient(BittensorClient):
    _FAKE_NETUIDS: tuple[int, ...] = (1, 3, 64)
    _FAKE_NAMES = {
        1: ("fake-text", "Synthetic text generation subnet"),
        3: ("fake-vision", "Synthetic image classification subnet"),
        64: ("fake-finetune", "Synthetic model fine-tuning subnet"),
    }
    _NEURONS_PER_SUBNET = 5

    def __init__(self, _now: Callable[[], datetime] | None = None) -> None:
        self._now = _now or (lambda: datetime.now(UTC))

    async def get_subnets(self) -> list[SubnetSnapshot]:
        now = self._now()
        out: list[SubnetSnapshot] = []
        for netuid in self._FAKE_NETUIDS:
            name, desc = self._FAKE_NAMES[netuid]
            out.append(SubnetSnapshot(
                netuid=netuid,
                name=name,
                description=desc,
                owner_hotkey=f"5FakeOwnerHotkey{netuid:04d}aaaaaaaaaaaaaaaaaaaaaaaaaa",
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

    async def get_metagraph(self, netuid: int) -> tuple[MetricsSnapshot, list[NeuronSnapshot]]:
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
                hotkey=f"5FakeNeuronHotkey{netuid:03d}{uid:03d}aaaaaaaaaaaaaaaaaaaaaaaa",
                coldkey=f"5FakeColdkey{netuid:03d}{uid:03d}bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
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

    async def get_emissions(self, netuid: int, block_range: int) -> list[EmissionSnapshot]:
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

    async def get_incentives(self, netuid: int, block_range: int) -> list[IncentiveSnapshot]:
        now = self._now()
        return [
            IncentiveSnapshot(
                netuid=netuid,
                uid=uid,
                hotkey=f"5FakeNeuronHotkey{netuid:03d}{uid:03d}aaaaaaaaaaaaaaaaaaaaaaaa",
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
