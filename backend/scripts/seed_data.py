"""
Seed script — populates the database with realistic Bittensor subnet data
so the dashboard shows meaningful numbers in mock/dev mode.

Run: python -m scripts.seed_data
Or:  python scripts/seed_data.py
"""
import asyncio
import logging
import random
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import db_manager, get_async_session
from app.models import (
    Emission,
    Incentive,
    Miner,
    MinerHealth,
    Neuron,
    OpportunityScore,
    ScoreComponent,
    Subnet,
    SubnetMetrics,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# Realistic Bittensor subnet names (subset of the ~32 active subnets on testnet)
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
    """Generate a fake Bittensor hotkey (ss58-like string)."""
    return "5" + "".join(random.choices("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789", k=47))


async def seed_subnets(session: AsyncSession) -> list[Subnet]:
    """Insert the 33 canonical Bittensor subnets. Idempotent."""
    existing = (await session.execute(select(Subnet.netuid))).scalars().all()
    existing_set = set(existing)
    new_subnets: list[Subnet] = []
    for spec in SUBNET_SEED:
        if spec["netuid"] in existing_set:
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
            registration_open=spec["netuid"] >= 20,  # newer subnets still open
            extra_metadata={"description": f"{spec['name']} — Bittensor subnet {spec['netuid']}"},
        )
        session.add(subnet)
        new_subnets.append(subnet)
    await session.flush()
    logger.info("Seeded %d new subnets", len(new_subnets))
    # Return all subnets for downstream seeding
    all_subnets = (await session.execute(select(Subnet).order_by(Subnet.netuid))).scalars().all()
    return list(all_subnets)


async def seed_metrics(session: AsyncSession, subnets: list[Subnet]) -> None:
    """Insert latest metrics for each subnet. Idempotent."""
    for subnet in subnets:
        existing = (
            await session.execute(
                select(SubnetMetrics).where(SubnetMetrics.netuid == subnet.netuid)
            )
        ).scalar_one_or_none()
        if existing:
            continue
        # Realistic-ish numbers: emission in TAO, stake, incentive ratios
        block = 5_000_000 + random.randint(0, 500_000)
        emission = round(random.uniform(0.1, 5.0), 6)
        total_stake = round(random.uniform(100, 50000), 2)
        average_incentive = round(random.uniform(0.1, 0.9), 4)
        metrics = SubnetMetrics(
            id=str(uuid.uuid4()),
            netuid=subnet.netuid,
            block=block,
            emission=emission,
            total_stake=total_stake,
            average_incentive=average_incentive,
            validator_count=random.randint(20, 64),
            miner_count=random.randint(50, 256),
            recorded_at=datetime.now(timezone.utc),
        )
        session.add(metrics)

        # Seed an Emission row
        session.add(
            Emission(
                id=str(uuid.uuid4()),
                netuid=subnet.netuid,
                block=block,
                tao_emission=emission,
                alpha_emission=emission * 0.85,
                timestamp=datetime.now(timezone.utc),
            )
        )
        # Seed an Incentive row
        session.add(
            Incentive(
                id=str(uuid.uuid4()),
                netuid=subnet.netuid,
                block=block,
                incentive_ratio=average_incentive,
                timestamp=datetime.now(timezone.utc),
            )
        )
    await session.flush()
    logger.info("Seeded metrics for %d subnets", len(subnets))


async def seed_neurons_and_miners(session: AsyncSession, subnets: list[Subnet]) -> None:
    """Insert a few neurons/miners per subnet so the monitoring overview shows counts."""
    existing_count = (await session.execute(select(Miner))).scalars().all()
    if existing_count:
        logger.info("Miners already present, skipping neuron/miner seed")
        return

    miners_added = 0
    for subnet in subnets:
        n_miners = random.randint(8, 30)
        for uid in range(n_miners):
            hotkey = _hotkey()
            miner = Miner(
                id=str(uuid.uuid4()),
                netuid=subnet.netuid,
                uid=uid,
                hotkey=hotkey,
                coldkey=_hotkey(),
                stake=round(random.uniform(100, 10000), 2),
                trust=round(random.random(), 4),
                consensus=round(random.random(), 4),
                incentive=round(random.random(), 4),
                emission=round(random.uniform(0, 2), 6),
                rank=uid,
                is_active=random.random() > 0.1,
                last_update=datetime.now(timezone.utc) - timedelta(minutes=random.randint(0, 60)),
            )
            session.add(miner)
            miners_added += 1
    await session.flush()
    logger.info("Seeded %d miners", miners_added)


async def seed_opportunities(session: AsyncSession, subnets: list[Subnet]) -> None:
    """Insert an OpportunityScore for each subnet so the opportunities page has rows."""
    existing = (await session.execute(select(OpportunityScore))).scalars().all()
    if existing:
        logger.info("Opportunities already present, skipping")
        return
    for subnet in subnets:
        score = OpportunityScore(
            id=str(uuid.uuid4()),
            netuid=subnet.netuid,
            total_score=round(random.uniform(30, 95), 2),
            model_version="v1.0-seed",
            rank=subnet.netuid,
            confidence=round(random.uniform(0.5, 0.95), 4),
            risk_level=random.choice(["low", "medium", "high"]),
            computed_at=datetime.now(timezone.utc),
        )
        session.add(score)
    await session.flush()
    logger.info("Seeded opportunity scores for %d subnets", len(subnets))


async def main() -> None:
    """Entry point: wire the DB, seed all tables, commit."""
    try:
        await db_manager.connect()
    except Exception as exc:
        logger.error("Cannot connect to database: %s", exc)
        logger.error("Set DATABASE_URL or DATABASE_POOLER_URL in the environment")
        raise

    async for session in get_async_session():
        try:
            subnets = await seed_subnets(session)
            await seed_metrics(session, subnets)
            await seed_neurons_and_miners(session, subnets)
            await seed_opportunities(session, subnets)
            await session.commit()
            logger.info("Seed complete.")
        except Exception:
            await session.rollback()
            raise
    await db_manager.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
