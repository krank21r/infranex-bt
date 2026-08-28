"""
Discovery Service — orchestrates the subnet discovery pipeline.

Calls `BittensorClient` for chain data, maps snapshots to ORM rows via
`ingestion.py`, and persists through `SubnetService`. Owns the
transaction boundary for each sub-scan; per-step errors are collected
and surfaced in the result so one bad netuid doesn't fail the whole
cycle.

The scanner worker calls `run_full_scan()` on every tick.
"""
from __future__ import annotations

import logging
from typing import Dict, List

from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.bittensor import BittensorClient
from app.services.ingestion import subnet_from_snapshot
from app.services.subnet_service import SubnetService

logger = logging.getLogger(__name__)

# Default block range for emission/incentive pulls (~1 day at 12s blocks).
DEFAULT_BLOCK_RANGE = 7200

# Tag written to data_source when the real SDK is the source. Used so the
# audit trail can distinguish real chain data from fake-mode test data.
DATA_SOURCE_REAL = "bittensor_sdk"
DATA_SOURCE_FAKE = "fake_bittensor"


def _data_source_for(client: BittensorClient) -> str:
    """Return the data_source tag to record on rows this client produced."""
    cls_name = type(client).__name__
    if cls_name == "RealBittensorClient":
        return DATA_SOURCE_REAL
    return DATA_SOURCE_FAKE


class DiscoveryService:
    def __init__(self, db: AsyncSession, client: BittensorClient) -> None:
        self.db = db
        self.client = client
        self.subnets = SubnetService(db)
        self._data_source = _data_source_for(client)

    async def sync_subnets(self) -> int:
        """Fetch the current subnet list and upsert each. Returns count upserted."""
        try:
            snapshots = await self.client.get_subnets()
        except Exception as e:
            logger.error("discovery_sync_subnets_failed", error=str(e))
            return 0

        count = 0
        for snap in snapshots:
            fields = subnet_from_snapshot(snap, data_source=self._data_source)
            await self.subnets.upsert(netuid=snap.netuid, **fields)
            count += 1
        logger.info("discovery_sync_subnets_done", count=count, source=self._data_source)
        return count

    async def sync_metrics(self, netuid: int) -> int:
        """Fetch metagraph for one netuid, write metrics + all neurons. Returns neuron count."""
        try:
            metrics_snap, neuron_snaps = await self.client.get_metagraph(netuid)
        except Exception as e:
            logger.error("discovery_sync_metrics_failed", netuid=netuid, error=str(e))
            return 0

        await self.subnets.append_metrics_history(
            netuid=netuid, snapshot=metrics_snap, data_source=self._data_source
        )
        for n_snap in neuron_snaps:
            await self.subnets.upsert_neuron(
                netuid=netuid, snapshot=n_snap, data_source=self._data_source
            )
        logger.info(
            "discovery_sync_metrics_done",
            netuid=netuid,
            neurons=len(neuron_snaps),
            source=self._data_source,
        )
        return len(neuron_snaps)

    async def sync_all_metrics(self) -> Dict[int, int]:
        """Sync metrics + neurons for every known netuid. Continues past per-netuid errors."""
        netuids = await self.subnets.get_known_netuids()
        results: Dict[int, int] = {}
        for netuid in netuids:
            try:
                results[netuid] = await self.sync_metrics(netuid)
            except Exception as e:
                logger.error("discovery_sync_metrics_per_netuid_failed", netuid=netuid, error=str(e))
                results[netuid] = 0
        return results

    async def sync_emissions(self, netuid: int, block_range: int = DEFAULT_BLOCK_RANGE) -> int:
        try:
            snaps = await self.client.get_emissions(netuid, block_range)
        except Exception as e:
            logger.error("discovery_sync_emissions_failed", netuid=netuid, error=str(e))
            return 0
        for snap in snaps:
            await self.subnets.append_emission(
                netuid=netuid, snapshot=snap, data_source=self._data_source
            )
        logger.info(
            "discovery_sync_emissions_done",
            netuid=netuid,
            count=len(snaps),
            source=self._data_source,
        )
        return len(snaps)

    async def sync_incentives(self, netuid: int, block_range: int = DEFAULT_BLOCK_RANGE) -> int:
        try:
            snaps = await self.client.get_incentives(netuid, block_range)
        except Exception as e:
            logger.error("discovery_sync_incentives_failed", netuid=netuid, error=str(e))
            return 0
        for snap in snaps:
            await self.subnets.append_incentive(
                netuid=netuid, snapshot=snap, data_source=self._data_source
            )
        logger.info(
            "discovery_sync_incentives_done",
            netuid=netuid,
            count=len(snaps),
            source=self._data_source,
        )
        return len(snaps)

    async def run_full_scan(self) -> dict:
        """One full discovery cycle. Returns a per-step result summary.

        Never raises — per-step errors are caught and surfaced in the
        `errors` list so the worker can log them and move on.
        """
        errors: List[str] = []

        try:
            subnets_count = await self.sync_subnets()
        except Exception as e:
            errors.append(f"sync_subnets: {e}")
            subnets_count = 0

        # After subnets are upserted, the netuid list is current.
        try:
            metrics_map = await self.sync_all_metrics()
        except Exception as e:
            errors.append(f"sync_all_metrics: {e}")
            metrics_map = {}

        neurons_total = sum(metrics_map.values())
        emissions_total = 0
        incentives_total = 0
        for netuid in metrics_map.keys():
            try:
                emissions_total += await self.sync_emissions(netuid)
            except Exception as e:
                errors.append(f"sync_emissions[{netuid}]: {e}")
            try:
                incentives_total += await self.sync_incentives(netuid)
            except Exception as e:
                errors.append(f"sync_incentives[{netuid}]: {e}")

        result = {
            "subnets": subnets_count,
            "metrics": metrics_map,
            "neurons": neurons_total,
            "emissions": emissions_total,
            "incentives": incentives_total,
            "errors": errors,
            "source": self._data_source,
        }
        logger.info("discovery_run_full_scan_done", **result)
        return result
