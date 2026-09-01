"""
Vercel Cron entry points — one POST endpoint per worker.

Vercel invokes these on a schedule defined in `vercel.json` and
includes the configured `CRON_SECRET` as a Bearer token. Each
endpoint constructs the worker, runs a single iteration, and
returns 200 (or 4xx/5xx on failure) so Vercel can record the
execution.

This is a thin HTTP wrapper around the existing BaseWorker.run()
coroutines — workers remain framework-agnostic and the cron
contract lives here.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.workers import (
    create_analyzer_worker,
    create_market_data_worker,
    create_scanner_worker,
    create_scoring_worker,
)

router = APIRouter(prefix="/cron", tags=["cron"])


def _verify_cron_secret(authorization: str | None) -> None:
    """
    Vercel sends `Authorization: Bearer <CRON_SECRET>` on every
    cron-triggered request. Reject anything else so the endpoint
    can't be hit from the public internet.
    """
    from app.core.config import settings  # local import to avoid startup cost

    expected = settings.CRON_SECRET
    if not expected:
        # If the secret isn't configured, refuse all cron calls —
        # better to fail loud than to expose a public trigger.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="CRON_SECRET not configured",
        )
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header",
        )
    token = authorization.removeprefix("Bearer ").strip()
    if token != expected:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid cron secret",
        )


@router.post("/scanner", status_code=status.HTTP_200_OK)
async def run_scanner(
    authorization: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    _verify_cron_secret(authorization)
    worker = create_scanner_worker(db=db)
    await worker.run()
    return {"ok": True, "worker": "scanner"}


@router.post("/market-data", status_code=status.HTTP_200_OK)
async def run_market_data(
    authorization: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    _verify_cron_secret(authorization)
    worker = create_market_data_worker()
    await worker.run()
    return {"ok": True, "worker": "market_data"}


@router.post("/scoring", status_code=status.HTTP_200_OK)
async def run_scoring(
    authorization: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    _verify_cron_secret(authorization)
    worker = create_scoring_worker(db=db)
    await worker.run()
    return {"ok": True, "worker": "scoring"}


@router.post("/analyzer", status_code=status.HTTP_200_OK)
async def run_analyzer(
    authorization: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    _verify_cron_secret(authorization)
    worker = create_analyzer_worker(db=db)
    await worker.run()
    return {"ok": True, "worker": "analyzer"}
