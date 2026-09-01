"""
Admin endpoints for database operations (seed, reset).

These endpoints are protected by a simple shared secret to prevent
unauthorized access in production.
"""
import logging
import os
from datetime import datetime, timedelta, timezone
import random
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.models import (
    Emission,
    Incentive,
    Miner,
    OpportunityScore,
    Subnet,
    SubnetMetrics,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


def _require_admin_secret(secret: str | None = None) -> None:
    """Gate admin endpoints behind the ADMIN_SECRET env var."""
    from app.core.config import settings

    expected = settings.ADMIN_SECRET or os.environ.get("ADMIN_SECRET", "")
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ADMIN_SECRET not configured",
        )
    if secret != expected:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid admin secret",
        )


SUBNET_SEED = [
    {"netuid": 0, "name": "Root", "subnet_type": "root", "tempo": 100, "max_neurons": 256},
    {"netuid": 1, "name": "Text Prompting", "subnet_type": "text", "tempo": 360, "max_neurons": 256},
    {"netuid": 2, "name": "Machine Translation", "subnet_type": "nlp", "tempo": 360, "max_neurons": 256},
    {"netuid": 3, "name": "Question Answering", "subnet_type": "nlp", "tempo": 360, "max_neurons": 256},
    {"netuid": 4, "name": "Text-to-Image", "subnet_type": "image", "tempo": 360, "max_neurons": 256},
    {"netuid": 5, "name": "MultiModal", "subnet_type": "multimodal", "tempo": 360, "max_neurons": 256},
    {"netuid": 6, "name": "Storage", "subnet_type": "storage", "tempo": 360, "max_neurons": 256},
    {"netuid": 7, "name": "MapReduce", "subnet_type": "compute", "tempo": 360, "max_neurons": 256},
    {"netuid": 8, "name": "Time Series", "subnet_type": "finance", "tempo": 360, "max_neurons": 256},
    {"netuid": 9, "name": "Pretraining", "subnet_type": "training", "tempo": 360, "max_neurons": 256},
    {"netuid": 10, "name": "Synthetic Data", "subnet_type": "data", "tempo": 360, "max_neurons": 256},
    {"netuid": 11, "name": "Video", "subnet_type": "video", "tempo": 360, "max_neurons": 256},
    {"netuid": 12, "name": "3D Generation", "subnet_type": "3d", "tempo": 360, "max_neurons": 256},
    {"netuid": 13, "name": "Data Retrieval", "subnet_type": "retrieval", "tempo": 360, "max_neurons": 256},
    {"netuid": 14, "name": "Image Generation", "subnet_type": "image", "tempo": 360, "max_neurons": 256},
    {"netuid": 15, "name": "Blockchain", "subnet_type": "crypto", "tempo": 360, "max_neurons": 256},
    {"netuid": 16, "name": "Audio", "subnet_type": "audio", "tempo": 360, "max_neurons": 256},
    {"netuid": 17, "name": "Speech", "subnet_type": "speech", "tempo": 360, "max_neurons": 256},
    {"netuid": 18, "name": "Coding", "subnet_type": "code", "tempo": 360, "max_neurons": 256},
    {"netuid": 19, "name": "Search", "subnet_type": "search", "tempo": 360, "max_neurons": 256},
    {"netuid": 20, "name": "Reasoning", "subnet_type": "reasoning", "tempo": 360, "max_neurons": 256},
    {"netuid": 21, "name": "RL Agent", "subnet_type": "rl", "tempo": 360, "max_neurons": 256},
    {"netuid": 22, "name": "Protein Folding", "subnet_type": "science", "tempo": 360, "max_neurons": 256},
    {"netuid": 23, "name": "Chemistry", "subnet_type": "science", "tempo": 360, "max_neurons": 256},
    {"netuid": 24, "name": "Weather", "subnet_type": "science", "tempo": 360, "max_neurons": 256},
    {"netuid": 25, "name": "Financial Forecasting", "subnet_type": "finance", "tempo": 360, "max_neurons": 256},
    {"netuid": 26, "name": "Document AI", "subnet_type": "document", "tempo": 360, "max_neurons": 256},
    {"netuid": 27, "name": "Translation", "subnet_type": "nlp", "tempo": 360, "max_neurons": 256},
    {"netuid": 28, "name": "Log Analysis", "subnet_type": "ops", "tempo": 360, "max_neurons": 256},
    {"netuid": 29, "name": "Code Review", "subnet_type": "code", "tempo": 360, "max_neurons": 256},
    {"netuid": 30, "name": "Synthetic Captioning", "subnet_type": "data", "tempo": 360, "max_neurons": 256},
    {"netuid": 31, "name": "Medical Imaging", "subnet_type": "healthcare", "tempo": 360, "max_neurons": 256},
    {"netuid": 32, "name": "Distributed Compute", "subnet_type": "compute", "tempo": 360, "max_neurons": 256},
]


def _hotkey() -> str:
    return "5" + "".join(
        random.choices(
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789", k=47
        )
    )


class SeedRequest(BaseModel):
    secret: str | None = None
    force: bool = False


class SeedResponse(BaseModel):
    subnets_added: int
    metrics_added: int
    miners_added: int
    opportunities_added: int
    duration_ms: int


@router.post("/seed", response_model=SeedResponse)
async def seed_database(
    body: SeedRequest,
    db: AsyncSession = Depends(get_db),
) -> SeedResponse:
    """Idempotently populate the database with realistic Bittensor data.

    Pass the ADMIN_SECRET in the request body. Set `force=true` to wipe
    miners/opportunities first (useful for re-seeding after a model change).
    """
    _require_admin_secret(body.secret)
    import time
    t0 = time.perf_counter()

    subnets_added = 0
    metrics_added = 0
    miners_added = 0
    opportunities_added = 0

    existing_netuids = set((await db.execute(select(Subnet.netuid))).scalars().all())
    subnets: list[Subnet] = []

    for spec in SUBNET_SEED:
        if spec["netuid"] in existing_netuids:
            continue
        subnet = Subnet(
            id=str(uuid.uuid4()),
            netuid=spec["netuid"],
            name=spec["name"],
            subnet_type=spec["subnet_type"],
            owner_hotkey=_hotkey(),
            max_neurons=spec["max_neurons"],
            max_allowed_validators=64,
            immunity_period=5000,
            tempo=spec["tempo"],
            min_difficulty=10**9,
            max_difficulty=10**12,
            difficulty=10**10 + random.randint(0, 10**10),
            rho=10,
            kappa=0.5 + random.random() * 0.4,
            is_active=True,
            registration_open=spec["netuid"] >= 20,
            extra_metadata={
                "description": f"{spec['name']} — Bittensor subnet {spec['netuid']}"
            },
        )
        db.add(subnet)
        subnets.append(subnet)
        subnets_added += 1
    await db.flush()

    all_subnets = list(
        (await db.execute(select(Subnet).order_by(Subnet.netuid))).scalars().all()
    )

    # Metrics + emissions + incentives
    have_metrics = set(
        (await db.execute(select(SubnetMetrics.netuid))).scalars().all()
    )
    now = datetime.now(timezone.utc)
    for subnet in all_subnets:
        if subnet.netuid in have_metrics:
            continue
        block = 5_000_000 + random.randint(0, 500_000)
        emission = round(random.uniform(0.1, 5.0), 6)
        total_stake = round(random.uniform(100, 50000), 2)
        avg_incentive = round(random.uniform(0.1, 0.9), 4)
        db.add(
            SubnetMetrics(
                id=str(uuid.uuid4()),
                netuid=subnet.netuid,
                block=block,
                emission=emission,
                total_stake=total_stake,
                average_incentive=avg_incentive,
                validator_count=random.randint(20, 64),
                miner_count=random.randint(50, 256),
                recorded_at=now,
            )
        )
        db.add(
            Emission(
                id=str(uuid.uuid4()),
                netuid=subnet.netuid,
                block=block,
                tao_emission=emission,
                alpha_emission=emission * 0.85,
                timestamp=now,
            )
        )
        db.add(
            Incentive(
                id=str(uuid.uuid4()),
                netuid=subnet.netuid,
                block=block,
                incentive_ratio=avg_incentive,
                timestamp=now,
            )
        )
        metrics_added += 1
    await db.flush()

    # Miners (skip if any exist, unless force=True)
    have_miners = (await db.execute(select(Miner.id).limit(1))).scalar_one_or_none()
    if have_miners and body.force:
        await db.execute(delete(Miner))
        have_miners = None
    if not have_miners:
        for subnet in all_subnets:
            for uid in range(random.randint(8, 30)):
                db.add(
                    Miner(
                        id=str(uuid.uuid4()),
                        netuid=subnet.netuid,
                        uid=uid,
                        hotkey=_hotkey(),
                        coldkey=_hotkey(),
                        stake=round(random.uniform(100, 10000), 2),
                        trust=round(random.random(), 4),
                        consensus=round(random.random(), 4),
                        incentive=round(random.random(), 4),
                        emission=round(random.uniform(0, 2), 6),
                        rank=uid,
                        is_active=random.random() > 0.1,
                        last_update=now - timedelta(minutes=random.randint(0, 60)),
                    )
                )
                miners_added += 1
        await db.flush()

    # Opportunity scores (idempotent)
    have_opps = (await db.execute(select(OpportunityScore.id).limit(1))).scalar_one_or_none()
    if have_opps and body.force:
        await db.execute(delete(OpportunityScore))
        have_opps = None
    if not have_opps:
        for subnet in all_subnets:
            db.add(
                OpportunityScore(
                    id=str(uuid.uuid4()),
                    netuid=subnet.netuid,
                    total_score=round(random.uniform(30, 95), 2),
                    model_version="v1.0-seed",
                    rank=subnet.netuid,
                    confidence=round(random.uniform(0.5, 0.95), 4),
                    risk_level=random.choice(["low", "medium", "high"]),
                    computed_at=now,
                )
            )
            opportunities_added += 1
        await db.flush()

    await db.commit()

    duration_ms = int((time.perf_counter() - t0) * 1000)
    logger.info(
        "Seeded: +%d subnets, +%d metrics, +%d miners, +%d opportunities in %dms",
        subnets_added, metrics_added, miners_added, opportunities_added, duration_ms,
    )
    return SeedResponse(
        subnets_added=subnets_added,
        metrics_added=metrics_added,
        miners_added=miners_added,
        opportunities_added=opportunities_added,
        duration_ms=duration_ms,
    )
