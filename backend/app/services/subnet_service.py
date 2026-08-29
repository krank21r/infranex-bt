"""
Subnet service — CRUD + metrics queries against the real ORM models.

Falls back to empty data when the database is not configured (mock/dev mode).
"""
import logging
from typing import Optional, List, Tuple

from sqlalchemy import select, func, or_, desc, asc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Subnet,
    SubnetMetrics,
    Neuron,
    Emission,
    Incentive,
    Repository,
    SubnetRequirement,
)

logger = logging.getLogger(__name__)


class SubnetService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_subnets(
        self,
        page: int = 1,
        page_size: int = 20,
        sort_by: str = "netuid",
        sort_order: str = "asc",
        is_active: Optional[bool] = None,
        search: Optional[str] = None,
    ) -> Tuple[List[Subnet], int]:
        query = select(Subnet)

        if is_active is not None:
            query = query.where(Subnet.is_active == is_active)
        if search:
            term = f"%{search}%"
            query = query.where(
                or_(Subnet.name.ilike(term), Subnet.description.ilike(term))
            )

        count_q = select(func.count()).select_from(query.subquery())
        total = await self.db.scalar(count_q) or 0

        col = getattr(Subnet, sort_by, Subnet.netuid)
        query = query.order_by(desc(col) if sort_order == "desc" else asc(col))
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.db.execute(query)
        return list(result.scalars().all()), total

    async def get_subnet(self, netuid: int) -> Optional[Subnet]:
        result = await self.db.execute(select(Subnet).where(Subnet.netuid == netuid))
        return result.scalar_one_or_none()

    async def latest_metrics(self, netuid: int) -> Optional[SubnetMetrics]:
        result = await self.db.execute(
            select(SubnetMetrics)
            .where(SubnetMetrics.netuid == netuid)
            .order_by(desc(SubnetMetrics.recorded_at))
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def count(self) -> int:
        result = await self.db.execute(select(func.count()).select_from(Subnet))
        return result.scalar() or 0

    async def upsert(self, netuid: int, **fields) -> Subnet:
        subnet = await self.get_subnet(netuid)
        if subnet is None:
            subnet = Subnet(netuid=netuid, **fields)
            self.db.add(subnet)
        else:
            for k, v in fields.items():
                if hasattr(subnet, k):
                    setattr(subnet, k, v)
        await self.db.commit()
        await self.db.refresh(subnet)
        return subnet

    async def get_known_netuids(self) -> List[int]:
        """Return all netuids currently tracked in the subnets table."""
        result = await self.db.execute(select(Subnet.netuid).order_by(Subnet.netuid))
        return [row[0] for row in result.all()]

    async def append_metrics_history(
        self,
        netuid: int,
        snapshot,
        data_source: str = "bittensor_sdk",
    ) -> SubnetMetrics:
        """Insert a new metrics row. Each call adds a history entry."""
        from app.services.ingestion import metrics_from_snapshot

        row = metrics_from_snapshot(snapshot, data_source=data_source)
        self.db.add(row)
        await self.db.commit()
        await self.db.refresh(row)
        return row

    async def upsert_neuron(self, netuid: int, snapshot, data_source: str = "bittensor_sdk") -> Neuron:
        """Match on (netuid, uid, hotkey) — update mutable fields if found, else insert."""
        from app.services.ingestion import neuron_from_snapshot

        result = await self.db.execute(
            select(Neuron).where(
                Neuron.netuid == netuid,
                Neuron.uid == snapshot.uid,
                Neuron.hotkey == snapshot.hotkey,
            )
        )
        existing = result.scalar_one_or_none()
        if existing is None:
            row = neuron_from_snapshot(snapshot, data_source=data_source)
            self.db.add(row)
        else:
            for field_name in (
                "coldkey", "stake", "rank", "trust", "consensus", "incentive",
                "emission", "dividends", "active", "validator_permit", "last_update",
            ):
                value = getattr(snapshot, field_name, None)
                if value is not None:
                    setattr(existing, field_name, value)
            existing.data_source = data_source
            row = existing
        await self.db.commit()
        await self.db.refresh(row)
        return row

    async def append_neuron_history(self, netuid: int, snapshot, data_source: str = "bittensor_sdk") -> Neuron:
        """Always insert a new neuron row (history-style)."""
        from app.services.ingestion import neuron_from_snapshot

        row = neuron_from_snapshot(snapshot, data_source=data_source)
        self.db.add(row)
        await self.db.commit()
        await self.db.refresh(row)
        return row

    async def append_emission(self, netuid: int, snapshot, data_source: str = "bittensor_sdk") -> Emission:
        from app.services.ingestion import emission_from_snapshot

        row = emission_from_snapshot(snapshot, data_source=data_source)
        self.db.add(row)
        await self.db.commit()
        await self.db.refresh(row)
        return row

    async def append_incentive(self, netuid: int, snapshot, data_source: str = "bittensor_sdk") -> Incentive:
        from app.services.ingestion import incentive_from_snapshot

        row = incentive_from_snapshot(snapshot, data_source=data_source)
        self.db.add(row)
        await self.db.commit()
        await self.db.refresh(row)
        return row

    # --- Phase 4: repository + requirement persistence (Analyzer) ---

    async def get_repository(self, netuid: int, url: str) -> Optional[Repository]:
        result = await self.db.execute(
            select(Repository).where(
                Repository.netuid == netuid,
                Repository.url == url,
            )
        )
        return result.scalar_one_or_none()

    async def get_latest_requirement(self, netuid: int) -> Optional[SubnetRequirement]:
        """Return the most-recently-recorded SubnetRequirement for a netuid, or None."""
        result = await self.db.execute(
            select(SubnetRequirement)
            .where(SubnetRequirement.netuid == netuid)
            .order_by(desc(SubnetRequirement.id))
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def upsert_repository(self, repository: Repository) -> Repository:
        """Upsert by (netuid, url) — one Repository row per (subnet, repo URL)."""
        existing = await self.get_repository(repository.netuid, repository.url)
        if existing is None:
            self.db.add(repository)
            row = repository
        else:
            for field_name in (
                "branch", "last_analyzed_at", "analysis_status",
                "readme_content", "repo_metadata",
            ):
                value = getattr(repository, field_name, None)
                if value is not None:
                    setattr(existing, field_name, value)
            row = existing
        await self.db.commit()
        await self.db.refresh(row)
        return row

    async def upsert_requirement(self, requirement: SubnetRequirement) -> SubnetRequirement:
        """Upsert by (netuid, repository_id) — one current requirement per repo."""
        result = await self.db.execute(
            select(SubnetRequirement).where(
                SubnetRequirement.netuid == requirement.netuid,
                SubnetRequirement.repository_id == requirement.repository_id,
            )
        )
        existing = result.scalar_one_or_none()
        if existing is None:
            self.db.add(requirement)
            row = requirement
        else:
            for field_name in (
                "python_version", "cuda_version", "pytorch_version",
                "min_vram_gb", "recommended_gpu", "ram_gb", "cpu_cores", "storage_gb",
                "docker_required", "nvidia_runtime_required",
                "ports", "env_variables", "startup_command", "miner_command",
                "dependencies", "raw_requirements", "extraction_confidence",
            ):
                value = getattr(requirement, field_name, None)
                if value is not None:
                    setattr(existing, field_name, value)
            row = existing
        await self.db.commit()
        await self.db.refresh(row)
        return row

    async def get_unanalyzed_netuids(self) -> List[int]:
        """Return netuids that have no Repository row yet (first-pass prioritization)."""
        result = await self.db.execute(
            select(Subnet.netuid).outerjoin(
                Repository, Repository.netuid == Subnet.netuid,
            ).where(Repository.id.is_(None))
        )
        return [row[0] for row in result.all()]
