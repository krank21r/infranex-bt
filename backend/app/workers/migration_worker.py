"""
Migration Worker — Pass #16 (live scheduler).

Background worker that periodically scans all 'started' or
'provisioned' deployments, calls
`MonitoringService.should_migrate_for_deployment` on each, and
raises a pending `ApprovalRequest(action_type=deployment.migrate,
status=pending)` when the rolling ROI is negative.

Phase scope (min-viable, per user decisions):
  - `MigrationWorker(BaseWorker)` — fits the existing
    `app.workers.base.BaseWorker` pattern (graceful shutdown,
    retry, metrics). No new loop framework.
  - `run()` is idempotent. If a deployment already has a pending
    migrate-approval, the worker skips it (avoids
    approval-spam). The double-approval guard rail in
    `ApprovalService` catches the rest.
  - Per-action: one ApprovalRequest row, status=pending. The
    operator still must call `POST /api/approvals/{id}/approve`
    before any real terminate fires. Auto-approval is explicitly
    out of scope (coldkey + approval-gated feedback memories).
  - No notification / webhook when a row is created.
  - No background task spawned in the FastAPI lifespan. The
    worker runs on demand via the cron endpoint
    (`POST /api/cron/migration`) and is therefore reachable
    from Vercel Cron or a manual operator trigger.

NOT in scope (deferred):
  - Web UI for live status / interval config.
  - Auto-approval.
  - Multi-window ROI analysis.
  - Backpressure / circuit breaker.
  - Spawning the worker in the FastAPI `lifespan` so it runs
    in-process (separate concern; the cron endpoint suffices
    for the current deployment target, Vercel).
"""
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Deployment
from app.models.audit import ApprovalRequest
from app.services.monitoring_service import MonitoringService
from app.workers.base import BaseWorker, RetryConfig, StructuredLogger

logger = logging.getLogger(__name__)

# Action label for the raised ApprovalRequest row.
# Mirrors `app.services.approval_service.ACTION_MIGRATE` so the
# row the worker writes has the same action_type the operator
# (or the future approve_migrate call) expects to see.
ACTION_MIGRATE = "deployment.migrate"

# Statuses a deployment must be in for the worker to consider it.
# The migrator only makes sense once a server is actually
# running; 'provisioned' (server up, miner not yet started) and
# 'started' (miner producing emissions) are both candidates.
ELIGIBLE_STATUSES = ("started", "provisioned")

# Reason prefix used in ApprovalRequest.reason. The operator UI
# (and future filtering) can match on this prefix to surface
# auto-raised migrate approvals distinctly from manual ones.
AUTO_REASON_PREFIX = "auto-raised by migration worker: "


class MigrationWorker(BaseWorker):
    """Periodically raise migrate-approvals for negative-ROI deployments.

    Usage:
        worker = create_migration_worker(db=session, interval_seconds=1800.0)
        await worker.start()      # spawns the background loop
        ...
        await worker.stop()       # graceful shutdown
        metrics = worker.get_metrics()

    Or one-shot:
        worker = create_migration_worker(db=session)
        await worker.run()        # single tick
    """

    def __init__(
        self,
        interval_seconds: float = 1800.0,  # 30 min default
        config: dict[str, Any] | None = None,
        db: AsyncSession | None = None,
    ):
        retry_config = RetryConfig(
            max_attempts=3,
            base_delay=1.0,
            max_delay=10.0,
        )
        super().__init__(
            name="migration",
            interval_seconds=interval_seconds,
            retry_config=retry_config,
        )
        self.config = config or {}
        self.db = db
        self.logger = StructuredLogger("worker.migration")
        # TAO price is the operator-configured input to
        # `should_migrate_for_deployment`. In production the
        # operator sets this; in tests the caller injects it.
        self._tao_price_usd: float = float(
            self.config.get("tao_price_usd", 100.0)
        )

    # ---------- main tick ----------

    async def run(self) -> None:
        """One migration-scan pass.

        1. List deployments in ELIGIBLE_STATUSES.
        2. For each, call `MonitoringService.should_migrate_for_deployment`.
        3. If the signal.should_migrate is True, raise a pending
           ApprovalRequest row (idempotent: skip if one is already
           pending for this (deployment_id, deployment.migrate)).
        """
        self.logger.info("migration_cycle_starting")

        if self.db is None:
            raise RuntimeError(
                "MigrationWorker requires a db session"
            )

        deployments = await self._list_eligible_deployments()
        self.logger.info(
            "eligible_deployments_loaded",
            count=len(deployments),
        )

        raised = 0
        skipped = 0
        errors: list[str] = []
        for deployment in deployments:
            try:
                outcome = await self._evaluate(deployment)
                if outcome == "raised":
                    raised += 1
                else:
                    skipped += 1
            except Exception as e:
                errors.append(f"deployment_id={deployment.id}: {e}")
                self.logger.error(
                    "deployment_evaluation_failed",
                    deployment_id=deployment.id,
                    error=str(e),
                )

        self.logger.info(
            "migration_cycle_complete",
            raised=raised,
            skipped=skipped,
            errors=len(errors),
        )
        if errors:
            for err in errors:
                self.logger.error(f"migration_error {err}")

    # ---------- internals ----------

    async def _list_eligible_deployments(self) -> list[Deployment]:
        """Return deployments in `ELIGIBLE_STATUSES`."""
        stmt = select(Deployment).where(
            Deployment.status.in_(ELIGIBLE_STATUSES)
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def _has_pending_migrate_approval(
        self, deployment_id: str
    ) -> bool:
        """True if a pending migrate-approval already exists for this deployment.

        This is the idempotency check. Without it, the worker
        would raise a fresh pending row on every tick. The
        double-approval guard rail in ApprovalService catches
        the second decision attempt, but a flood of pending
        rows is itself a problem.
        """
        stmt = (
            select(ApprovalRequest)
            .where(
                ApprovalRequest.subject_type == "deployment",
                ApprovalRequest.subject_id == deployment_id,
                ApprovalRequest.action_type == ACTION_MIGRATE,
                ApprovalRequest.status == "pending",
            )
            .limit(1)
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def _evaluate(self, deployment: Deployment) -> str:
        """Run the migrator for one deployment. Returns 'raised' or 'skipped'."""
        monitor = MonitoringService(self.db)
        signal = await monitor.should_migrate_for_deployment(
            deployment_id=deployment.id,
            tao_price_usd=self._tao_price_usd,
        )
        if signal is None:
            self.logger.debug(
                "deployment_skipped_no_signal",
                deployment_id=deployment.id,
            )
            return "skipped"
        if not signal.should_migrate:
            self.logger.debug(
                "deployment_skipped_roi_ok",
                deployment_id=deployment.id,
                rolling_roi=signal.rolling_roi,
                sample_size=signal.sample_size,
            )
            return "skipped"

        # Negative ROI with enough observations. Idempotency check
        # first so we don't spam the approvals table.
        if await self._has_pending_migrate_approval(deployment.id):
            self.logger.info(
                "deployment_skipped_pending_approval_exists",
                deployment_id=deployment.id,
            )
            return "skipped"

        approval = ApprovalRequest(
            action_type=ACTION_MIGRATE,
            level="L3_mandatory",
            status="pending",
            requested_by="migration_worker",
            subject_type="deployment",
            subject_id=deployment.id,
            payload={
                "rolling_roi": signal.rolling_roi,
                "sample_size": signal.sample_size,
                "model_version": signal.model_version,
                "tao_price_usd": self._tao_price_usd,
            },
            reason=AUTO_REASON_PREFIX + signal.reason,
        )
        self.db.add(approval)
        await self.db.commit()
        self.logger.info(
            "migrate_approval_raised",
            deployment_id=deployment.id,
            rolling_roi=signal.rolling_roi,
            sample_size=signal.sample_size,
        )
        return "raised"


def create_migration_worker(
    interval_seconds: float = 1800.0,
    config: dict[str, Any] | None = None,
    db: AsyncSession | None = None,
) -> MigrationWorker:
    """Factory mirroring the other `create_*_worker` helpers."""
    return MigrationWorker(
        interval_seconds=interval_seconds,
        config=config,
        db=db,
    )
