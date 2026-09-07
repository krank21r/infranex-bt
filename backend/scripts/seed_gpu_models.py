#!/usr/bin/env python3
"""Seed GPU models from RunPod API data into Supabase PostgreSQL.

Run: python scripts\seed_gpu_models.py

This script:
1. Connects to Supabase using the DATABASE_URL from environment
2. Checks if GPU models already exist (skips if so)
3. Inserts 45 GPU models from RunPod API
4. Commits the transaction
"""

import logging
import os
import sys

# Ensure backend directory is in Python path so `app` can be imported
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select

from app.core.database import db_manager
from app.models import GPUModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# 45 GPU models from RunPod API (datacenter + consumer)
GPU_MODELS_DATA = [
    # Datacenter GPUs
    ("NVIDIA A100 80GB SXM", "NVIDIA", 80.0, 6912, "Ada", 2039.0, 19.5, 19.5, None, "Ada", "datacenter"),
    ("NVIDIA A100 80GB PCIe", "NVIDIA", 80.0, 6912, "Ada", 1550.0, 7.8, 19.5, None, "Ada", "datacenter"),
    ("NVIDIA A100-SXM4-40GB", "NVIDIA", 40.0, 4352, "Ada", 1550.0, 4.68, 9.36, None, "Ada", "datacenter"),
    ("NVIDIA A40", "NVIDIA", 48.0, 10624, "Ada", 912.0, 6.7, 16.7, None, "Ada", "datacenter"),
    ("NVIDIA H100 80GB SXM", "NVIDIA", 80.0, 16896, "Hopper", 3350.0, 19.79, 5.12, None, "Hopper", "datacenter"),
    ("AMD Instinct MI300X OAM", "AMD", 192.0, 15360, "CDNA3", 3840.0, 200.0, 53.0, None, "CDNA3", "datacenter"),
    ("NVIDIA B200", "NVIDIA", 180.0, 20480, "Blackwell", 8000.0, 20.0, 10.0, None, "Blackwell", "datacenter"),
    ("NVIDIA H100 NVL", "NVIDIA", 94.0, None, "Hopper", None, None, None, None, None, "datacenter"),
    ("NVIDIA H100 PCIe", "NVIDIA", 80.0, None, "Hopper", None, None, None, None, None, "datacenter"),
    ("NVIDIA H100 SXM", "NVIDIA", 80.0, None, "Hopper", None, None, None, None, None, "datacenter"),
    ("NVIDIA H200 NVL", "NVIDIA", 143.0, None, "Hopper", None, None, None, None, None, "datacenter"),
    ("NVIDIA H200 SXM", "NVIDIA", 141.0, None, "Hopper", None, None, None, None, None, "datacenter"),
    ("NVIDIA L4", "NVIDIA", 24.0, None, None, 24.0, None, None, None, None, "datacenter"),
    ("NVIDIA L40", "NVIDIA", 48.0, None, None, 48.0, None, None, None, None, "datacenter"),
    ("NVIDIA L40S", "NVIDIA", 48.0, None, None, 48.0, None, None, None, None, "datacenter"),
    ("NVIDIA MI300X", "NVIDIA", 192.0, 15360, "CDNA3", 3840.0, 200.0, 53.0, None, "CDNA3", "datacenter"),
    ("NVIDIA PRO 6000 MIG 24GB", "NVIDIA", 24.0, None, None, 24.0, None, None, None, None, "datacenter"),
    ("NVIDIA PRO 6000 MIG 48GB", "NVIDIA", 48.0, None, None, 48.0, None, None, None, None, "datacenter"),
    ("NVIDIA RTX 2000 Ada", "NVIDIA", 16.0, None, "Ada", 16.0, None, None, None, None, "consumer"),
    ("NVIDIA RTX 5000 Ada", "NVIDIA", 32.0, None, "Ada", 32.0, None, None, None, None, "consumer"),
    ("NVIDIA RTX 5080", "NVIDIA", 16.0, None, "Ada", 16.0, None, None, None, None, "consumer"),
    ("NVIDIA RTX 5090", "NVIDIA", 32.0, None, "Ada", 32.0, None, None, None, None, "consumer"),
    ("NVIDIA RTX 6000 Ada", "NVIDIA", 48.0, None, "Ada", 48.0, None, None, None, None, "consumer"),
    ("NVIDIA RTX A4000", "NVIDIA", 16.0, None, "Ampere", 16.0, None, None, None, None, "consumer"),
    ("NVIDIA RTX A4500", "NVIDIA", 20.0, None, "Ampere", 20.0, None, None, None, None, "consumer"),
    ("NVIDIA RTX A5000", "NVIDIA", 24.0, None, "Ampere", 24.0, None, None, None, None, "consumer"),
    ("NVIDIA RTX A6000", "NVIDIA", 48.0, None, "Ampere", 48.0, None, None, None, None, "consumer"),
    ("NVIDIA RTX PRO 4000", "NVIDIA", 24.0, None, "Ada", 24.0, None, None, None, None, "consumer"),
    ("NVIDIA RTX PRO 4500", "NVIDIA", 32.0, None, "Ada", 32.0, None, None, None, None, "consumer"),
    ("NVIDIA RTX PRO 4500 SE", "NVIDIA", 32.0, None, "Ada", 32.0, None, None, None, None, "consumer"),
    ("NVIDIA RTX PRO 5000", "NVIDIA", 48.0, None, "Ada", 48.0, None, None, None, None, "consumer"),
    ("NVIDIA RTX PRO 6000", "NVIDIA", 96.0, None, "Ada", 96.0, None, None, None, None, "consumer"),
    ("NVIDIA RTX PRO 6000 MaxQ", "NVIDIA", 96.0, None, "Ada", 96.0, None, None, None, None, "consumer"),
    ("NVIDIA V100 SXM2", "NVIDIA", 16.0, None, None, 16.0, None, None, None, None, "datacenter"),
    # Consumer GPUs
    ("NVIDIA GeForce RTX 3070", "NVIDIA", 8.0, 5888, "Ampere", 448.0, 22.4, 22.4, None, "Ampere", "consumer"),
    ("NVIDIA GeForce RTX 3080", "NVIDIA", 10.0, 8960, "Ampere", 760.0, 29.8, 29.8, None, "Ampere", "consumer"),
    ("NVIDIA GeForce RTX 3080 Ti", "NVIDIA", 12.0, 10240, "Ampere", 912.0, 34.1, 34.1, None, "Ampere", "consumer"),
    ("NVIDIA GeForce RTX 3090", "NVIDIA", 24.0, 10496, "Ampere", 936.0, 35.6, 35.6, None, "Ampere", "consumer"),
    ("NVIDIA GeForce RTX 3090 Ti", "NVIDIA", 24.0, None, "Ampere", 936.0, None, None, None, None, "consumer"),
    ("NVIDIA RTX 4000 Ada", "NVIDIA", 20.0, None, "Ada", 20.0, None, None, None, None, "consumer"),
    ("NVIDIA GeForce RTX 4070 Ti", "NVIDIA", 12.0, 7808, "Ada", 504.0, 28.1, 28.1, None, "Ada", "consumer"),
    ("NVIDIA GeForce RTX 4080", "NVIDIA", 16.0, 9728, "Ada", 712.0, 48.5, 48.5, None, "Ada", "consumer"),
    ("NVIDIA GeForce RTX 4080 SUPER", "NVIDIA", 16.0, 10752, "Ada", 768.0, 56.0, 56.0, None, "Ada", "consumer"),
    ("NVIDIA GeForce RTX 4090", "NVIDIA", 24.0, 16384, "Ada", 1008.0, 82.6, 82.6, None, "Ada", "consumer"),
]


def seed_gpu_models() -> None:
    """Seed GPU models into the database using synchronous connection."""
    try:
        # Get sync engine and create session
        engine = db_manager.get_sync_engine()
        from sqlalchemy.orm import sessionmaker
        SessionFactory = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
        session = SessionFactory()

        logger.info("Connected to database (sync mode)")

        # Check if data already exists
        result = session.execute(select(GPUModel))
        existing = result.scalars().all()
        if existing:
            logger.info("GPU models already present, skipping seed")
            session.close()
            return

        for model_data in GPU_MODELS_DATA:
            name, manufacturer, vram_gb, cuda_cores, generation, memory_bandwidth_gbps, fp16_tflops, fp32_tflops, tdp_watts, tier, tier_name = model_data

            model = GPUModel(
                name=name,
                manufacturer=manufacturer,
                vram_gb=vram_gb,
                cuda_cores=cuda_cores,
                cuda_compute_capability=generation,
                memory_bandwidth_gbps=memory_bandwidth_gbps,
                fp16_tflops=fp16_tflops,
                fp32_tflops=fp32_tflops,
                tdp_watts=tdp_watts,
                generation=generation,
                tier=tier_name,
                is_active=True,
            )
            session.add(model)

        session.commit()
        logger.info("Seeded %d GPU models successfully!", len(GPU_MODELS_DATA))
        session.close()

    except Exception as exc:
        logger.error("Failed to seed GPU models: %s", exc)
        raise


if __name__ == "__main__":
    seed_gpu_models()
