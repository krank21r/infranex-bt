"""Tests for Docker installer."""
import asyncio

import pytest

from app.gpu_engine.docker_installer import (
    configure_docker_daemon,
    install_docker,
    install_nvidia_container_toolkit,
    verify_docker_gpu,
)
from app.gpu_engine.ssh_client import MockSSHClient


class TestDockerInstaller:
    @pytest.fixture
    def mock_ssh(self):
        ssh = MockSSHClient()
        asyncio.run(ssh.connect("test-host"))
        return ssh

    @pytest.mark.asyncio
    async def test_install_docker(self, mock_ssh):
        result = await install_docker(mock_ssh)
        assert result.success is True

    @pytest.mark.asyncio
    async def test_install_nvidia_container_toolkit(self, mock_ssh):
        result = await install_nvidia_container_toolkit(mock_ssh)
        assert result.success is True

    @pytest.mark.asyncio
    async def test_verify_docker_gpu(self, mock_ssh):
        result = await verify_docker_gpu(mock_ssh)
        assert result.success is True

    @pytest.mark.asyncio
    async def test_configure_docker_daemon(self, mock_ssh):
        result = await configure_docker_daemon(mock_ssh)
        assert result.success is True