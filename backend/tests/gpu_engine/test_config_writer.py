"""Tests for config writer."""
import asyncio

import pytest

from app.gpu_engine.config_writer import (
    chmod_executable,
    write_env_file,
    write_miner_config,
    write_startup_script,
)
from app.gpu_engine.ssh_client import MockSSHClient


class TestConfigWriter:
    @pytest.fixture
    def mock_ssh(self):
        ssh = MockSSHClient()
        asyncio.run(ssh.connect("test-host"))
        return ssh

    @pytest.mark.asyncio
    async def test_write_miner_config(self, mock_ssh):
        config = {"hotkey": "0x123", "netuid": 1}
        result = await write_miner_config(mock_ssh, config)
        assert result.success is True

    @pytest.mark.asyncio
    async def test_write_env_file(self, mock_ssh):
        env_vars = {"HOTKEY": "0x123", "WALLET_PATH": "/path/wallet"}
        result = await write_env_file(mock_ssh, env_vars)
        assert result.success is True

    @pytest.mark.asyncio
    async def test_write_startup_script(self, mock_ssh):
        script_content = "#!/bin/bash\necho 'starting miner'"
        result = await write_startup_script(mock_ssh, script_content)
        assert result.success is True

    @pytest.mark.asyncio
    async def test_chmod_executable(self, mock_ssh):
        result = await chmod_executable(mock_ssh, "/opt/miner/start.sh")
        assert result.success is True