# Worker image for the live Bittensor scanner.
#
# Build:
#   docker build -t infranex-bt-worker -f worker/Dockerfile .
#
# Run (one-shot scan):
#   docker run --rm --env-file .env.production infranex-bt-worker
#
# Run (long-lived loop):
#   docker run --rm --env-file .env.production infranex-bt-worker --loop
#
# The image installs bittensor (Rust toolchain + heavy native deps) and
# then copies only the backend code it needs. Total image size is
# dominated by the bittensor wheel (~150 MB), which is exactly why
# this lives outside the Vercel-bound FastAPI image.

FROM python:3.12-slim AS base

# System deps for bittensor (libsodium, libsecp256k1, etc.). The SDK
# has historically needed both; keeping them installed avoids runtime
# "libsecp256k1.so: cannot open shared object file" failures on
# first call to subtensor.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cargo \
    libsecp256k1-dev \
    libsodium-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (cache-friendly: deps change less than code)
COPY worker/requirements.txt /app/worker/requirements.txt
RUN pip install --no-cache-dir -r /app/worker/requirements.txt

# Now copy only the backend code the worker actually needs. We avoid
# COPYing the full `infranex-bt/backend` tree because it pulls in
# Vercel-only files (vercel.json, api/, etc.) that the worker never
# uses. Anything the worker imports must live under one of the
# directories below.
COPY infranex-bt/backend/app /app/app
COPY infranex-bt/backend/alembic /app/alembic
COPY infranex-bt/backend/alembic.ini /app/alembic.ini

# Worker entry point
COPY worker/main.py /app/worker_main.py

# Use unbuffered output so logs stream into docker logs / journald
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Default: run a single scan and exit. Use `--loop` for a long-lived
# process that scans every SCANNER_FAST_INTERVAL_SECONDS.
ENTRYPOINT ["python", "/app/worker_main.py"]
CMD ["--once"]
