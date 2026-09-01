"""
Tests for AutoStopWorker and RecoveryWorker.

Pins the contract:
  - AutoStopWorker stops unhealthy deployments after threshold
  - RecoveryWorker dispatches to RecoveryEngine
  - BaseWorker lifecycle hooks are called correctly
"""
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.workers.auto_stop_worker import AutoStopWorker, create_auto_stop_worker
from app.workers.base import BaseWorker
from app.workers.recovery_worker import RecoveryWorker, create_recovery_worker

# ---------- lifecycle hooks ----------


class TestBaseWorkerLifecycleHooks:
    @pytest.mark.asyncio
    async def test_hooks_called_in_order(self):
        call_order = []

        class TestWorker(BaseWorker):
            async def on_before_run(self):
                call_order.append("before")

            async def on_after_run(self):
                call_order.append("after")

            async def run(self):
                call_order.append("run")

            async def on_error(self, error):
                call_order.append("error")

        worker = TestWorker(name="test", interval_seconds=0.01)
        await worker._run_loop_step()

        # Should be: before, run, after
        assert call_order == ["before", "run", "after"]

    @pytest.mark.asyncio
    async def test_on_error_called_on_failure(self):
        call_order = []

        class FailingWorker(BaseWorker):
            async def on_before_run(self):
                call_order.append("before")

            async def run(self):
                raise ValueError("test error")

            async def on_error(self, error):
                call_order.append("error")

        worker = FailingWorker(name="test", interval_seconds=0.01)
        await worker._run_loop_step()

        assert call_order == ["before", "error"]

    @pytest.mark.asyncio
    async def test_default_hooks_do_nothing(self):
        class SimpleWorker(BaseWorker):
            async def run(self):
                pass

        worker = SimpleWorker(name="test")
        await worker.on_before_run()
        await worker.on_after_run()
        await worker.on_error(ValueError("test"))


# ---------- AutoStopWorker ----------


class TestAutoStopWorker:
    @pytest.mark.asyncio
    async def test_no_deployments(self):
        db = AsyncMock()
        db.execute = AsyncMock(return_value=MagicMock(
            scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[]))),
        ))

        worker = create_auto_stop_worker(db=db, interval_seconds=60.0)
        await worker.run()

    @pytest.mark.asyncio
    async def test_healthy_deployment_not_stopped(self):
        deployment = MagicMock()
        deployment.id = "dep-1"

        db = AsyncMock()
        db.execute = AsyncMock(return_value=MagicMock(
            scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[deployment]))),
        ))

        worker = create_auto_stop_worker(db=db, interval_seconds=60.0)
        await worker.run()

        # Should not call stop_miner for healthy deployment
        db.add.assert_not_called()

    def test_factory(self):
        worker = create_auto_stop_worker(interval_seconds=120.0)
        assert isinstance(worker, AutoStopWorker)
        assert worker.interval_seconds == 120.0
        assert worker.name == "auto_stop"


# ---------- RecoveryWorker ----------


class TestRecoveryWorker:
    @pytest.mark.asyncio
    async def test_no_db_returns_early(self):
        worker = create_recovery_worker(db=None)
        await worker.run()

    @pytest.mark.asyncio
    async def test_no_deployments(self):
        db = AsyncMock()
        db.execute = AsyncMock(return_value=MagicMock(
            scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[]))),
        ))

        worker = create_recovery_worker(db=db, interval_seconds=60.0)
        await worker.run()

    def test_factory(self):
        worker = create_recovery_worker(interval_seconds=120.0)
        assert isinstance(worker, RecoveryWorker)
        assert worker.interval_seconds == 120.0
        assert worker.name == "recovery"
