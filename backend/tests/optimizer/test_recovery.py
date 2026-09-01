"""
Tests for the Recovery module.

Pins the contract:
  - HealthChecker aggregates process, subnet, GPU state into healthy/degraded/unhealthy.
  - Strategies return RecoveryResult with correct action_type and level.
  - RecoveryEngine.decide maps health signals to the right strategy.
  - RecoveryEngine.execute dispatches to the strategy and returns its result.
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.recovery.health_checker import (
    HEALTH_CHECK_MODEL_VERSION,
    HealthChecker,
    HealthSignal,
    aggregate_health_signal,
)
from app.recovery.recovery import (
    RECOVERY_MODEL_VERSION,
    RecoveryAction,
    RecoveryEngine,
)
from app.recovery.strategies import (
    escalate_to_human,
    redeploy,
    restart_process,
    switch_subnet,
)

# ---------- health checker tests ----------


class TestHealthChecker:
    def test_unhealthy_when_process_not_running(self):
        signal = HealthChecker.aggregate(
            process_running=False,
            subnet_connected=True,
        )
        assert signal.status == "unhealthy"
        assert "miner process not running" in signal.errors

    def test_unhealthy_when_subnet_disconnected(self):
        signal = HealthChecker.aggregate(
            process_running=True,
            subnet_connected=False,
        )
        assert signal.status == "unhealthy"
        assert "subnet disconnected" in signal.errors

    def test_degraded_when_low_gpu_utilization(self):
        signal = HealthChecker.aggregate(
            process_running=True,
            subnet_connected=True,
            gpu_utilization=15.0,
        )
        assert signal.status == "degraded"
        assert "low GPU utilization" in signal.errors

    def test_degraded_when_high_gpu_temperature(self):
        signal = HealthChecker.aggregate(
            process_running=True,
            subnet_connected=True,
            gpu_utilization=60.0,
            gpu_temperature=90.0,
        )
        assert signal.status == "degraded"
        assert "high GPU temperature" in signal.errors

    def test_healthy_when_all_checks_pass(self):
        signal = HealthChecker.aggregate(
            process_running=True,
            subnet_connected=True,
            gpu_utilization=80.0,
            gpu_temperature=70.0,
        )
        assert signal.status == "healthy"
        assert signal.errors == []

    def test_check_miner_process_with_process_id(self):
        assert HealthChecker.check_miner_process(process_id=1234, status=None, miner_process_running=None) is True

    def test_check_miner_process_with_status(self):
        assert HealthChecker.check_miner_process(process_id=None, status="running", miner_process_running=None) is True
        assert HealthChecker.check_miner_process(process_id=None, status="stopped", miner_process_running=None) is False

    def test_check_miner_process_with_explicit_flag(self):
        assert HealthChecker.check_miner_process(process_id=None, status=None, miner_process_running=True) is True
        assert HealthChecker.check_miner_process(process_id=None, status=None, miner_process_running=False) is False

    def test_check_subnet_connectivity(self):
        assert HealthChecker.check_subnet_connectivity(True) is True
        assert HealthChecker.check_subnet_connectivity(False) is False
        assert HealthChecker.check_subnet_connectivity(None) is False

    def test_measure_gpu_utilization(self):
        assert HealthChecker.measure_gpu_utilization(50.0) == 50.0
        assert HealthChecker.measure_gpu_utilization(None) is None
        assert HealthChecker.measure_gpu_utilization(-10.0) == 0.0
        assert HealthChecker.measure_gpu_utilization(120.0) == 100.0

    def test_model_version_is_v1(self):
        assert HEALTH_CHECK_MODEL_VERSION == "v1.0"


class TestAggregateHealthSignal:
    def test_delegates_to_checker(self):
        signal = aggregate_health_signal(
            process_running=True,
            subnet_connected=True,
            gpu_utilization=60.0,
        )
        assert signal.status == "healthy"


# ---------- strategy tests ----------


def _make_mock_db():
    """Create a mock AsyncSession that returns MagicMock for db.get."""
    db = AsyncMock()
    db.get = AsyncMock(return_value=MagicMock())
    db.flush = AsyncMock()
    db.add = MagicMock()
    return db


class TestRestartProcessStrategy:
    @pytest.mark.asyncio
    async def test_returns_success_with_l2_level(self):
        db = _make_mock_db()
        deployment = MagicMock()
        deployment.id = "dep-1"
        deployment.server_id = "srv-1"
        db.get.return_value = deployment

        with patch("app.recovery.strategies.get_provider") as mock_provider:
            mock_provider.return_value.provision_server = AsyncMock(return_value=MagicMock(id="srv-2", provider_instance_id="inst-2"))
            result = await restart_process(db, {"miner_id": "m-1", "params": {"process_id": 42, "deployment_id": "dep-1"}})

        assert result.success is True
        assert result.action_type == "restart_miner"
        assert result.action_level == "L2_confirm"
        assert "m-1" in result.message

    @pytest.mark.asyncio
    async def test_to_dict_serializable(self):
        db = _make_mock_db()
        deployment = MagicMock()
        deployment.id = "dep-1"
        deployment.server_id = "srv-1"
        db.get.return_value = deployment

        with patch("app.recovery.strategies.get_provider") as mock_provider:
            mock_provider.return_value.provision_server = AsyncMock(return_value=MagicMock(id="srv-2", provider_instance_id="inst-2"))
            result = await restart_process(db, {"miner_id": "m-1", "params": {"deployment_id": "dep-1"}})

        d = result.to_dict()
        assert d["success"] is True
        assert d["action_type"] == "restart_miner"
        assert "executed_at" in d

    @pytest.mark.asyncio
    async def test_fails_when_deployment_not_found(self):
        db = AsyncMock()
        db.get = AsyncMock(return_value=None)

        result = await restart_process(db, {"miner_id": "m-1", "params": {"deployment_id": "missing"}})
        assert result.success is False
        assert "not found" in result.message


class TestRedeployStrategy:
    @pytest.mark.asyncio
    async def test_fresh_deployment_is_l3(self):
        db = _make_mock_db()
        deployment = MagicMock()
        deployment.id = "dep-1"
        deployment.server_id = "srv-1"
        db.get.return_value = deployment

        with patch("app.recovery.strategies.DeploymentService") as mock_svc_cls:
            mock_svc = MagicMock()
            mock_svc.redeploy_miner = AsyncMock(return_value=MagicMock(status="deploying", server_id="srv-1"))
            mock_svc_cls.return_value = mock_svc
            result = await redeploy(db, {
                "miner_id": "m-1",
                "params": {"is_new_deployment": True, "deployment_id": "dep-1"},
            })

        assert result.action_type == "deploy_new_miner"
        assert result.action_level == "L3_mandatory"

    @pytest.mark.asyncio
    async def test_recovery_is_l2(self):
        db = _make_mock_db()
        deployment = MagicMock()
        deployment.id = "dep-1"
        deployment.server_id = "srv-1"
        db.get.return_value = deployment

        with patch("app.recovery.strategies.DeploymentService") as mock_svc_cls:
            mock_svc = MagicMock()
            mock_svc.redeploy_miner = AsyncMock(return_value=MagicMock(status="deploying", server_id="srv-1"))
            mock_svc_cls.return_value = mock_svc
            result = await redeploy(db, {
                "miner_id": "m-1",
                "params": {"is_new_deployment": False, "deployment_id": "dep-1"},
            })

        assert result.action_type == "recover_container"
        assert result.action_level == "L2_confirm"

    @pytest.mark.asyncio
    async def test_fails_when_deployment_not_found(self):
        db = AsyncMock()
        db.get = AsyncMock(return_value=None)

        result = await redeploy(db, {
            "miner_id": "m-1",
            "params": {"is_new_deployment": True, "deployment_id": "missing"},
        })
        assert result.success is False
        assert "not found" in result.message


class TestSwitchSubnetStrategy:
    @pytest.mark.asyncio
    async def test_new_subnet_is_l3(self):
        db = _make_mock_db()
        miner = MagicMock()
        miner.id = "m-1"
        miner.deployment_id = "dep-1"
        miner.netuid = 1
        db.get.return_value = miner

        with patch("app.recovery.strategies.get_provider") as mock_provider:
            mock_provider.return_value.provision_server = AsyncMock(return_value=MagicMock(id="srv-2", provider_instance_id="inst-2"))
            result = await switch_subnet(db, {
                "miner_id": "m-1",
                "params": {"is_new_subnet": True, "target_netuid": 5, "deployment_id": "dep-1"},
            })

        assert result.action_type == "migrate_to_new_subnet"
        assert result.action_level == "L3_mandatory"

    @pytest.mark.asyncio
    async def test_existing_subnet_is_l2(self):
        db = _make_mock_db()
        miner = MagicMock()
        miner.id = "m-1"
        miner.deployment_id = "dep-1"
        miner.netuid = 1
        db.get.return_value = miner

        with patch("app.recovery.strategies.get_provider") as mock_provider:
            mock_provider.return_value.provision_server = AsyncMock(return_value=MagicMock(id="srv-2", provider_instance_id="inst-2"))
            result = await switch_subnet(db, {
                "miner_id": "m-1",
                "params": {"is_new_subnet": False, "target_netuid": 3, "deployment_id": "dep-1"},
            })

        assert result.action_type == "switch_subnet_within_roi_band"
        assert result.action_level == "L2_confirm"

    @pytest.mark.asyncio
    async def test_fails_when_miner_not_found(self):
        db = AsyncMock()
        db.get = AsyncMock(return_value=None)

        result = await switch_subnet(db, {
            "miner_id": "missing",
            "params": {"is_new_subnet": True, "target_netuid": 5},
        })
        assert result.success is False
        assert "not found" in result.message


class TestEscalateToHumanStrategy:
    @pytest.mark.asyncio
    async def test_always_l3(self):
        db = AsyncMock()
        with patch("app.recovery.strategies.ApprovalService") as mock_svc_cls:
            mock_svc = MagicMock()
            mock_svc.create = AsyncMock(return_value="approval-123")
            mock_svc_cls.return_value = mock_svc
            result = await escalate_to_human(db, {"miner_id": "m-1", "reason": "unknown failure"})

        assert result.action_type == "escalate_to_human"
        assert result.action_level == "L3_mandatory"
        assert result.success is True


# ---------- recovery engine tests ----------


class TestRecoveryEngineDecide:
    @pytest.mark.asyncio
    async def test_unhealthy_process_not_running_maps_to_restart(self):
        engine = RecoveryEngine(db=AsyncMock())
        miner = MagicMock()
        miner.id = "m-1"
        miner.deployment_id = "dep-1"
        miner.netuid = 1
        miner.process_id = 100

        signal = HealthSignal(
            status="unhealthy",
            process_running=False,
            subnet_connected=True,
            gpu_utilization=50.0,
            gpu_temperature=70.0,
            gpu_memory_utilization=40.0,
            errors=[],
            signal_timestamp="2026-01-01T00:00:00Z",
            model_version="v1.0",
        )

        async def fake_execute(stmt):
            r = MagicMock()
            if "miners" in str(stmt).lower():
                r.scalar_one_or_none.return_value = miner
            return r

        engine.db.execute = AsyncMock(side_effect=fake_execute)

        action = await engine.decide("m-1", signal)
        assert action.action_type == "restart_process"
        assert action.action_level == "L2_confirm"
        assert "not running" in action.reason

    @pytest.mark.asyncio
    async def test_unhealthy_subnet_disconnected_maps_to_restart(self):
        engine = RecoveryEngine(db=AsyncMock())
        miner = MagicMock()
        miner.id = "m-1"
        miner.deployment_id = "dep-1"
        miner.netuid = 1
        miner.process_id = 100

        signal = HealthSignal(
            status="unhealthy",
            process_running=True,
            subnet_connected=False,
            gpu_utilization=50.0,
            gpu_temperature=70.0,
            gpu_memory_utilization=40.0,
            errors=[],
            signal_timestamp="2026-01-01T00:00:00Z",
            model_version="v1.0",
        )

        async def fake_execute(stmt):
            r = MagicMock()
            if "miners" in str(stmt).lower():
                r.scalar_one_or_none.return_value = miner
            return r

        engine.db.execute = AsyncMock(side_effect=fake_execute)

        action = await engine.decide("m-1", signal)
        assert action.action_type == "restart_process"
        assert "connectivity" in action.reason

    @pytest.mark.asyncio
    async def test_degraded_maps_to_restart(self):
        engine = RecoveryEngine(db=AsyncMock())
        miner = MagicMock()
        miner.id = "m-1"
        miner.deployment_id = "dep-1"
        miner.netuid = 1
        miner.process_id = 100

        signal = HealthSignal(
            status="degraded",
            process_running=True,
            subnet_connected=True,
            gpu_utilization=15.0,
            gpu_temperature=70.0,
            gpu_memory_utilization=40.0,
            errors=["low GPU utilization"],
            signal_timestamp="2026-01-01T00:00:00Z",
            model_version="v1.0",
        )

        async def fake_execute(stmt):
            r = MagicMock()
            if "miners" in str(stmt).lower():
                r.scalar_one_or_none.return_value = miner
            return r

        engine.db.execute = AsyncMock(side_effect=fake_execute)

        action = await engine.decide("m-1", signal)
        assert action.action_type == "restart_process"
        assert action.action_level == "L2_confirm"

    @pytest.mark.asyncio
    async def test_decide_raises_when_miner_not_found(self):
        engine = RecoveryEngine(db=AsyncMock())

        async def fake_execute(stmt):
            r = MagicMock()
            r.scalar_one_or_none.return_value = None
            return r

        engine.db.execute = AsyncMock(side_effect=fake_execute)

        signal = HealthSignal(
            status="unhealthy",
            process_running=False,
            subnet_connected=True,
            gpu_utilization=None,
            gpu_temperature=None,
            gpu_memory_utilization=None,
            errors=[],
            signal_timestamp="2026-01-01T00:00:00Z",
            model_version="v1.0",
        )
        with pytest.raises(LookupError):
            await engine.decide("missing-miner", signal)


class TestRecoveryEngineExecute:
    @pytest.mark.asyncio
    async def test_execute_restart_process(self):
        db = _make_mock_db()
        deployment = MagicMock()
        deployment.id = "dep-1"
        deployment.server_id = "srv-1"
        db.get.return_value = deployment

        engine = RecoveryEngine(db=db)
        action = RecoveryAction(
            action_type="restart_process",
            miner_id="m-1",
            reason="test",
            action_level="L2_confirm",
            params={"process_id": 42, "deployment_id": "dep-1"},
        )

        with patch("app.recovery.strategies.get_provider") as mock_provider:
            mock_provider.return_value.provision_server = AsyncMock(return_value=MagicMock(id="srv-2", provider_instance_id="inst-2"))
            result = await engine.execute(action)

        assert result.success is True
        assert result.action_type == "restart_miner"

    @pytest.mark.asyncio
    async def test_execute_unknown_action_returns_failure(self):
        engine = RecoveryEngine(db=AsyncMock())
        action = RecoveryAction(
            action_type="unknown_action",
            miner_id="m-1",
            reason="test",
            action_level="L3_mandatory",
            params={},
        )
        result = await engine.execute(action)
        assert result.success is False
        assert "Unknown recovery action" in result.message

    @pytest.mark.asyncio
    async def test_execute_escalate_to_human(self):
        db = AsyncMock()
        engine = RecoveryEngine(db=db)
        action = RecoveryAction(
            action_type="escalate_to_human",
            miner_id="m-1",
            reason="test",
            action_level="L3_mandatory",
            params={},
        )
        with patch("app.recovery.strategies.ApprovalService") as mock_svc_cls:
            mock_svc = MagicMock()
            mock_svc.create = AsyncMock(return_value="approval-123")
            mock_svc_cls.return_value = mock_svc
            result = await engine.execute(action)

        assert result.success is True
        assert result.action_type == "escalate_to_human"
        assert result.action_level == "L3_mandatory"


# ---------- model version pin ----------


def test_recovery_model_version_is_v1():
    assert RECOVERY_MODEL_VERSION == "v1.0"
