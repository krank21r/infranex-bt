"""
Bittensor scanner worker — long-running container for live chain data.

Two modes:
- `--once`   : one full scan, then exit. Use for cron / one-off replays.
- `--loop`   : scan every `SCANNER_FAST_INTERVAL_SECONDS` (default 300)
              until SIGTERM. Use for a long-lived Fly.io / Railway /
              VPS process.

This module lives outside `infranex-bt/backend/app/` so the worker
container can be deployed independently of the FastAPI service. It
imports the same `app.*` packages the API uses, so a single
`DiscoveryService` instance is the source of truth for both reads
(API) and writes (this worker).

Env vars (same names as the FastAPI service so one .env works for both):
- DEPLOYMENT_MODE=production       -> RealBittensorClient
- BITTENSOR_NETWORK=finney|testnet
- BITTENSOR_RPC_ENDPOINT           -> optional override
- DATABASE_URL | DATABASE_POOLER_URL
- REDIS_URL | UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
- SCANNER_FAST_INTERVAL_SECONDS=300
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import signal
import sys
from contextlib import suppress

# Make the backend `app` package importable when this module runs as
# the container entrypoint. The Dockerfile sets WORKDIR=/app and
# copies `infranex-bt/backend/app` to /app/app, so the package lives
# at /app/app.
sys.path.insert(0, "/app")

from app.clients.bittensor import get_bittensor_client  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.database import close_database, get_async_session, init_database  # noqa: E402
from app.services.discovery_service import DATA_SOURCE_REAL, DiscoveryService  # noqa: E402

logger = logging.getLogger("worker.main")


def _configure_logging() -> None:
    level = getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        stream=sys.stdout,
    )


async def _run_once() -> dict:
    """Run a single discovery cycle. Returns the run_full_scan() result."""
    await init_database()
    client = get_bittensor_client()
    source = type(client).__name__
    logger.info("scanner_start source=%s network=%s endpoint=%s",
                source, settings.BITTENSOR_NETWORK, settings.BITTENSOR_RPC_ENDPOINT)

    async for session in get_async_session():
        discovery = DiscoveryService(session, client)
        result = await discovery.run_full_scan()
        logger.info(
            "scanner_done subnets=%d neurons=%d emissions=%d incentives=%d errors=%d source=%s",
            result["subnets"],
            result["neurons"],
            result["emissions"],
            result["incentives"],
            len(result["errors"]),
            result["source"],
        )
        if result["source"] != DATA_SOURCE_REAL:
            logger.warning(
                "scanner_running_with_non_real_source source=%s expected=%s",
                result["source"], DATA_SOURCE_REAL,
            )
        break  # single iteration; get_async_session is a generator

    return result


async def _run_loop(interval_seconds: float) -> None:
    """Run scans forever, sleeping `interval_seconds` between them.

    Catches per-cycle exceptions so a single bad scan doesn't kill
    the loop. SIGTERM/SIGINT triggers a clean shutdown.
    """
    stop = asyncio.Event()

    def _signal(_signum, _frame):
        logger.info("scanner_signal_received stopping")
        stop.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        with suppress(ValueError):
            signal.signal(sig, _signal)

    logger.info("scanner_loop_start interval=%.0fs", interval_seconds)
    while not stop.is_set():
        try:
            await _run_once()
        except Exception as e:
            logger.exception("scanner_cycle_failed err=%s", e)
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval_seconds)
        except asyncio.TimeoutError:
            pass  # normal — time for the next cycle

    logger.info("scanner_loop_stopped")
    await close_database()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Infranex BT Bittensor scanner worker")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="Run a single scan and exit (default)")
    mode.add_argument("--loop", action="store_true", help="Run scans on an interval forever")
    parser.add_argument(
        "--interval",
        type=float,
        default=float(settings.SCANNER_FAST_INTERVAL_SECONDS),
        help="Seconds between scans in --loop mode (default: SCANNER_FAST_INTERVAL_SECONDS)",
    )
    return parser.parse_args()


def main() -> int:
    _configure_logging()
    args = _parse_args()

    if args.loop:
        asyncio.run(_run_loop(args.interval))
    else:
        try:
            asyncio.run(_run_once())
        except Exception as e:
            logger.exception("scanner_failed err=%s", e)
            return 1
        try:
            asyncio.run(close_database())
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
