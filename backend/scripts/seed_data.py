"""
Seed script — populates the database with realistic Bittensor subnet data
so the dashboard shows meaningful numbers in mock/dev mode.

Run: python -m scripts.seed_data
Or:  python scripts/seed_data.py
"""
import asyncio
import logging
import os
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone

# Ensure backend directory is in Python path so `app` can be imported
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import db_manager
from app.models import (
    Emission,
    Incentive,
    Miner,
    Neuron,
    OpportunityScore,
    ScoreComponent,
    Subnet,
    SubnetMetrics,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

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
    return "5" + "".join(random.choices("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789", k=47))


async def seed_subnets(session: AsyncSession) -> list[Subnet]:
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
            registration_open=spec["netuid"] >= 20,
            extra_metadata={"description": f"{spec['name']} — Bittensor subnet {spec['netuid']}"},
        )
        session.add(subnet)
        new_subnets.append(subnet)
    await session.flush()
    logger.info("Seeded %d new subnets", len(new_subnets))
    all_subnets = (await session.execute(select(Subnet).order_by(Subnet.netuid))).scalars().all()
    return list(all_subnets)


async def seed_metrics(session: AsyncSession, subnets: list[Subnet]) -> None:
    for subnet in subnets:
        existing = (
            await session.execute(
                select(SubnetMetrics).where(SubnetMetrics.netuid == subnet.netuid)
            )
        ).scalar_one_or_none()
        if existing:
            continue
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

        session.add(
            Emission(
                id=str(uuid.uuid4()),
                netuid=subnet.netuid,
                block=block,
                emission_amount=emission,
                subnet_emission=emission * 0.85,
                owner_emission=emission * 0.1,
                miner_emission=emission * 0.75,
                validator_emission=emission * 0.15,
                recorded_at=datetime.now(timezone.utc),
            )
        )
        session.add(
            Incentive(
                id=str(uuid.uuid4()),
                netuid=subnet.netuid,
                uid=random.randint(0, 255),
                hotkey=_hotkey(),
                incentive=average_incentive,
                emission=emission,
                stake=total_stake,
                block=block,
                recorded_at=datetime.now(timezone.utc),
            )
        )
    await session.flush()
    logger.info("Seeded metrics for %d subnets", len(subnets))


async def seed_neurons(session: AsyncSession, subnets: list[Subnet]) -> None:
    existing_count = (await session.execute(select(Neuron))).scalars().all()
    if existing_count:
        logger.info("Neurons already present, skipping neuron seed")
        return

    neurons_added = 0
    for subnet in subnets:
        n_neurons = random.randint(8, 30)
        for uid in range(n_neurons):
            neuron = Neuron(
                id=str(uuid.uuid4()),
                netuid=subnet.netuid,
                uid=uid,
                hotkey=_hotkey(),
                coldkey=_hotkey(),
                stake=round(random.uniform(100, 10000), 2),
                rank=round(random.uniform(0, 1), 4),
                trust=round(random.random(), 4),
                consensus=round(random.random(), 4),
                incentive=round(random.random(), 4),
                emission=round(random.uniform(0, 2), 6),
                active=random.random() > 0.1,
                last_update=int(datetime.now(timezone.utc).timestamp()),
                recorded_at=datetime.now(timezone.utc),
            )
            session.add(neuron)
            neurons_added += 1
    await session.flush()
    logger.info("Seeded %d neurons", neurons_added)


async def seed_opportunities(session: AsyncSession, subnets: list[Subnet]) -> None:
    existing = (await session.execute(select(OpportunityScore))).scalars().all()
    if existing:
        logger.info("Opportunities already present, skipping")
        return
    for subnet in subnets:
        score = OpportunityScore(
            id=str(uuid.uuid4()),
            netuid=subnet.netuid,
            score=round(random.uniform(30, 95), 2),
            score_model_version="v1.0-seed",
            confidence=round(random.uniform(0.5, 0.95), 4),
            risk_level=random.choice(["low", "medium", "high"]),
            explanation=f"Seed opportunity score for {subnet.name}",
            is_current=True,
        )
        session.add(score)
    await session.flush()
    logger.info("Seeded opportunity scores for %d subnets", len(subnets))


async def main() -> None:
    try:
        ok = await db_manager.ping()
        if not ok:
            raise RuntimeError("Database ping failed")
    except Exception as exc:
        logger.error("Cannot connect to database: %s", exc)
        logger.error("Set DATABASE_URL or DATABASE_POOLER_URL in the environment")
        raise

    async with db_manager.get_async_session() as session:
        try:
            subnets = await seed_subnets(session)
            await seed_metrics(session, subnets)
            await seed_neurons(session, subnets)
            await seed_opportunities(session, subnets)
            await session.commit()
            logger.info("Seed complete.")
        except Exception:
            await session.rollback()
            raise
    await db_manager.close()


if __name__ == "__main__":
    asyncio.run(main())
