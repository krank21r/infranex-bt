"""Tests for GPU Engine models."""
from app.gpu_engine.models import (
    InstallationResult,
    InstallationStep,
    MinerConfig,
    ServerSpec,
)


class TestInstallationStep:
    def test_step_start(self):
        step = InstallationStep(name="test_step")
        step.start()
        assert step.status == "running"
        assert step.started_at is not None

    def test_step_success(self):
        step = InstallationStep(name="test_step")
        step.start()
        step.success("output data")
        assert step.status == "success"
        assert step.output == "output data"
        assert step.duration_seconds is not None

    def test_step_fail(self):
        step = InstallationStep(name="test_step")
        step.start()
        step.fail("error message")
        assert step.status == "failed"
        assert step.error == "error message"
        assert step.duration_seconds is not None


class TestInstallationResult:
    def test_result_creation(self):
        result = InstallationResult(success=True)
        assert result.success is True
        assert result.steps == []
        assert result.total_duration_seconds == 0.0

    def test_result_with_steps(self):
        step = InstallationStep(name="test_step")
        step.success("output")
        result = InstallationResult(
            success=True,
            steps=[step],
            total_duration_seconds=5.0,
        )
        assert result.success is True
        assert len(result.steps) == 1
        assert result.completed_steps == 1


class TestServerSpec:
    def test_server_spec_creation(self):
        spec = ServerSpec(
            provider="test",
            offer_id="offer-123",
            gpu_model="A100",
            vram_gb=80.0,
            region="us-east",
            ssh_host="192.168.1.1",
            ssh_user="root",
        )
        assert spec.provider == "test"
        assert spec.gpu_model == "A100"
        assert spec.vram_gb == 80.0


class TestMinerConfig:
    def test_miner_config_creation(self):
        config = MinerConfig(
            hotkey="0x123...",
            netuid=1,
            wallet_path="/path/to/wallet",
            wallet_name="test_wallet",
        )
        assert config.hotkey == "0x123..."
        assert config.netuid == 1
        assert config.wallet_path == "/path/to/wallet"
        assert config.wallet_name == "test_wallet"
        assert config.custom_settings == {}

    def test_miner_config_with_custom(self):
        config = MinerConfig(
            hotkey="0x123...",
            netuid=1,
            wallet_path="/path/to/wallet",
            wallet_name="test_wallet",
            custom_settings={"key": "value"},
        )
        assert config.custom_settings == {"key": "value"}