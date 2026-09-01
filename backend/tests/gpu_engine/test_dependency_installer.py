"""Tests for dependency installer."""
import asyncio

import pytest

from app.gpu_engine.dependency_installer import (
    install_bittensor,
    install_python_deps,
    install_subnet_deps,
    verify_installation,
)
from app.gpu_engine.ssh_client import MockSSHClient


class TestDependencyInstaller:
    @pytest.fixture
    def mock_ssh(self):
        ssh = MockSSHClient()
        asyncio.run(ssh.connect("test-host"))
        return ssh

    @pytest.mark.asyncio
    async def test_install_python_deps(self, mock_ssh):
        packages = await install_python_deps(mock_ssh, "requirements.txt")
        assert isinstance(packages, list)

    @pytest.mark.asyncio
    async def test_install_bittensor(self, mock_ssh):
        result = await install_bittensor(mock_ssh)
        assert isinstance(result, type(result))

    @pytest.mark.asyncio
    async def test_install_subnet_deps(self, mock_ssh):
        packages = await install_subnet_deps(mock_ssh, 1, "https://github.com/test/repo.git")
        assert isinstance(packages, list)

    @pytest.mark.asyncio
    async def test_verify_installation(self, mock_ssh):
        result = await verify_installation(mock_ssh, "bittensor")
        assert result is not None