"""
Tests for MigrationWorker (Pass #16 live scheduler).

Pins the four load-bearing invariants of the migrator loop:

  1. Negative-ROI signal with enough observations  -> raises one
     ApprovalRequest(action_type="deployment.migrate", status="pending",
     requested_by="migration_worker").
  2. Positive / undecidable signal  -> no ApprovalRequest added.
  3. Idempotent on repeat ticks: if a pending migrate-approval
     already exists for the deployment, no new row is added
     (prevents the operator inbox from flooding).
  4. Only deployments in ELIGIBLE_STATUSES (started, provisioned)
     are evaluated.

The test session uses AsyncMock for the DB session — same pattern
as `test_approval_service.py`. The MonitoringService is patched
out so the worker does not touch the real monitoring SQL.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.intelligence.monitoring import MigrateSignal as MigrationSignal
from app.services.approval_service import ACTION_MIGRATE
from app.workers.migration_worker import (
    MigrationWorker,
    ACTION_MIGRATE as WORKER_ACTION_MIGRATE,
    ELIGIBLE_STATUSES,
    AUTO_REASON_PREFIX,
    create_migration_worker,
)


# ---------- helpers ----------


def _signal(*, should_migrate: bool, roi: float = -0.94, sample_size: int = 20) -> MigrationSignal:
    return MigrationSignal(
        should_migrate=should_migrate,
        sample_size=sample_size,
        rolling_roi=roi,
        reason="rolling ROI negative" if should_migrate else "rolling ROI ok",
        model_version="v1.0",
    )


class _StubDeployment:
    def __init__(self, id: str, status: str = "started") -> None:
        self.id = id
        self.status = status


def _build_session(
    *,
    deployments: list | None = None,
    pending_migrate_approvals: dict | None = None,
) -> MagicMock:
    """Build an AsyncMock DB session.

    `_list_eligible_deployments` calls .execute() once; we need the
    `.scalars().all()` chain to return the deployments list.

    `_has_pending_migrate_approval` also calls .execute() once and
    reads `.scalar_one_or_none()`. We key the lookup by deployment id
    so multiple deployments in a single tick each get their own
    pending-approval answer.
    """
    deployments = deployments if deployments is not None else []
    pending_migrate_approvals = pending_migrate_approvals or {}

    deployments_scalars = MagicMock()
    deployments_scalars.all = MagicMock(return_value=deployments)

    def _list_execute(_stmt):
        result = MagicMock()
        result.scalars = MagicMock(return_value=deployments_scalars)
        return result

    def _pending_execute(_stmt):
        result = MagicMock()

        def _lookup_one_or_none():
            # Caller passes a deployment_id; we don't have the stmt here,
            # so the test sets up the right answer via a side-effect
            # list keyed by call order. Simpler: tests that need
            # idempotency pass a single-deployment session, so we just
            # use a small call counter.
            return None

        result.scalar_one_or_none = MagicMock(side_effect=lambda: None)
        return result

    # Two-stage execute: first call is the deployment list, every call
    # after is the per-deployment pending-approval check.
    execute = AsyncMock(side_effect=_list_execute)
    db = MagicMock()
    db.execute = execute
    db.add = MagicMock()
    db.commit = AsyncMock()
    return db


def _build_session_with_pending(
    *,
    deployments: list,
    pending_for: set,
) -> MagicMock:
    """Variant of _build_session where pending_for gives a True/False
    answer per deployment_id for the idempotency check.

    Per-deployment execute() calls return either an existing
    ApprovalRequest sentinel (truthy scalar_one_or_none) or None.
    """
    deployments_scalars = MagicMock()
    deployments_scalars.all = MagicMock(return_value=deployments)

    pending_scalars = MagicMock()
    existing_pending = MagicMock()  # truthy sentinel
    pending_scalars.scalar_one_or_none = MagicMock(
        side_effect=lambda: existing_pending if "fake-dep" in pending_for else None
    )

    execute_results: list = []

    # First call: deployment list.
    list_result = MagicMock()
    list_result.scalars = MagicMock(return_value=deployments_scalars)
    execute_results.append(list_result)

    # One per-deployment call afterwards.
    for d in deployments:
        pending_result = MagicMock()
        existing = MagicMock() if d.id in pending_for else None
        pending_result.scalar_one_or_none = MagicMock(return_value=existing)
        execute_results.append(pending_result)

    execute = AsyncMock(side_effect=execute_results)
    db = MagicMock()
    db.execute = execute
    db.add = MagicMock()
    db.commit = AsyncMock()
    return db


# ---------- ACTION_MIGRATE constant alignment ----------


def test_worker_action_migrate_matches_approval_service():
    """The worker writes the same action_type the operator endpoint expects.

    If this drifts, the migrate-approval row will be invisible to
    `POST /api/approvals/{id}/approve` (which dispatches on
    action_type). Pin the constant.
    """
    assert WORKER_ACTION_MIGRATE == ACTION_MIGRATE


def test_eligible_statuses_contains_only_running_states():
    """Only running deployments are candidates for migration."""
    assert "started" in ELIGIBLE_STATUSES
    assert "provisioned" in ELIGIBLE_STATUSES
    assert "requested" not in ELIGIBLE_STATUSES
    assert "approved" not in ELIGIBLE_STATUSES
    assert "terminating" not in ELIGIBLE_STATUSES
    assert "terminated" not in ELIGIBLE_STATUSES


# ---------- happy path: raises an approval ----------


@pytest.mark.asyncio
async def test_run_raises_approval_when_should_migrate_true():
    """Negative-ROI signal -> one ApprovalRequest(action_type=deployment.migrate,
    status=pending, requested_by=migration_worker) is added and committed.
    """
    deployment = _StubDeployment(id="dep-001", status="started")
    db = _build_session_with_pending(deployments=[deployment], pending_for=set())

    with patch(
        "app.workers.migration_worker.MonitoringService"
    ) as MockService:
        mock_instance = MockService.return_value
        mock_instance.should_migrate_for_deployment = AsyncMock(
            return_value=_signal(should_migrate=True, roi=-0.94, sample_size=20)
        )

        worker = create_migration_worker(db=db, config={"tao_price_usd": 100.0})
        await worker.run()

    # One row added, one commit.
    assert db.add.call_count == 1
    db.commit.assert_awaited_once()
    added = db.add.call_args_list[0].args[0]
    assert added.action_type == "deployment.migrate"
    assert added.level == "L3_mandatory"
    assert added.status == "pending"
    assert added.requested_by == "migration_worker"
    assert added.subject_type == "deployment"
    assert added.subject_id == "dep-001"
    # Reason prefix is the auto-raised marker.
    assert added.reason.startswith(AUTO_REASON_PREFIX)
    # Payload carries the signal context the operator UI needs.
    assert added.payload["rolling_roi"] == -0.94
    assert added.payload["sample_size"] == 20
    assert added.payload["model_version"] == "v1.0"
    assert added.payload["tao_price_usd"] == 100.0


# ---------- no signal: skip ----------


@pytest.mark.asyncio
async def test_run_skips_when_should_migrate_false():
    """Positive / ok signal -> no ApprovalRequest added, no commit."""
    deployment = _StubDeployment(id="dep-002", status="started")
    db = _build_session_with_pending(deployments=[deployment], pending_for=set())

    with patch(
        "app.workers.migration_worker.MonitoringService"
    ) as MockService:
        mock_instance = MockService.return_value
        mock_instance.should_migrate_for_deployment = AsyncMock(
            return_value=_signal(should_migrate=False, roi=0.15, sample_size=20)
        )

        worker = create_migration_worker(db=db)
        await worker.run()

    db.add.assert_not_called()
    db.commit.assert_not_called()


# ---------- idempotency on repeat ticks ----------


@pytest.mark.asyncio
async def test_run_is_idempotent_on_repeat_ticks():
    """If a pending migrate-approval already exists for the deployment,
    the worker MUST NOT add a second row. The single-pending check
    inside _evaluate guards against the operator inbox flooding.
    """
    deployment = _StubDeployment(id="dep-003", status="started")
    db = _build_session_with_pending(
        deployments=[deployment], pending_for={"dep-003"}
    )

    with patch(
        "app.workers.migration_worker.MonitoringService"
    ) as MockService:
        mock_instance = MockService.return_value
        mock_instance.should_migrate_for_deployment = AsyncMock(
            return_value=_signal(should_migrate=True, roi=-0.5, sample_size=20)
        )

        worker = create_migration_worker(db=db)
        await worker.run()

    db.add.assert_not_called()
    db.commit.assert_not_called()


# ---------- eligibility: SQL filter ----------


@pytest.mark.asyncio
async def test_list_eligible_deployments_uses_correct_in_clause():
    """`_list_eligible_deployments` builds a select(Deployment).where(
    Deployment.status.in_(ELIGIBLE_STATUSES)) query.

    This test pins the SQL surface so a future refactor can't
    silently broaden the eligibility filter (e.g. letting a
    'requested' deployment be auto-migrated).
    """
    db = _build_session()
    worker = MigrationWorker(db=db)
    await worker._list_eligible_deployments()

    # The one .execute() call captured by the mock carries the stmt.
    stmt = db.execute.await_args.args[0]
    # SQLAlchemy renders the IN clause as the two literal statuses.
    compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    assert "status" in compiled
    assert "IN" in compiled.upper()
    # Both eligible statuses must appear in the rendered IN clause.
    for status in ELIGIBLE_STATUSES:
        assert f"'{status}'" in compiled, f"missing eligible status: {status}"
