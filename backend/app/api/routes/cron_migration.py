"""
Migration cron endpoint — Pass #16 (live scheduler).

Mirrors the four existing worker endpoints in `cron.py`, but
lives in a separate file so the `app.workers` import chain
stays out of the other endpoints' import surface. The endpoint
verifies the `CRON_SECRET` Bearer token, constructs a
`MigrationWorker` against the request-scoped DB session, and
runs one tick. Returns 200 on success; 4xx on auth failure.

Single-tick design: Vercel Cron (or a manual operator
trigger) drives cadence. The worker itself is stateless
across ticks — idempotency is in the ApprovalRequest table.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.workers.migration_worker import create_migration_worker

router = APIRouter(prefix="/cron", tags=["cron"])


def _verify_cron_secret(authorization: str | None) -> None:
    """Mirror the secret check from `app.api.routes.cron`.

    Duplicated rather than imported so the existing cron
    module stays unchanged (new-files-only constraint). The
    function is small and the contract is documented in the
    original.
    """
    from app.core.config import settings  # local import to avoid startup cost

    expected = settings.CRON_SECRET
    if not expected:
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


@router.post("/migration", status_code=status.HTTP_200_OK)
async def run_migration(
    authorization: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """One migration-scan tick.

    Returns {"ok": True, "worker": "migration"} on success.
    The worker does not return counts; the operator reads
    `GET /api/approvals/pending` to see any auto-raised rows.
    """
    _verify_cron_secret(authorization)
    worker = create_migration_worker(db=db)
    await worker.run()
    return {"ok": True, "worker": "migration"}
