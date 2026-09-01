"""Tests for CUDA installer."""
import asyncio

import pytest

from app.gpu_engine.cuda_installer import (
    install_cuda_driver,
    install_nvidia_driver,
    verify_cuda_installation,
)
from app.gpu_engine.ssh_client import MockSSHClient


class TestCUDAInstaller:
    @pytest.fixture
    def mock_ssh(self):
        ssh = MockSSHClient()
        asyncio.run(ssh.connect("test-host"))
        return ssh

    @pytest.mark.asyncio
    async def test_install_cuda_driver(self, mock_ssh):
        result = await install_cuda_driver(mock_ssh, "12.2")
        assert result.success is True
        assert len(result.version) > 0

    @pytest.mark.asyncio
    async def test_install_nvidia_driver(self, mock_ssh):
        result = await install_nvidia_driver(mock_ssh)
        assert result.success is True

    @pytest.mark.asyncio
    async def test_verify_cuda_installation(self, mock_ssh):
        result = await verify_cuda_installation(mock_ssh)
        assert result.success is True
        assert len(result.version) > 0