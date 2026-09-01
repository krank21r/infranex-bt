from __future__ import annotations

import logging
from abc import ABC, abstractmethod

logger = logging.getLogger(__name__)


class SSHClient(ABC):
    """Abstract SSH client interface for GPU provider engine operations."""

    @abstractmethod
    async def exec_command(self, command: str) -> tuple[str, str, int]:
        """Execute a command on the remote server.

        Returns (stdout, stderr, return_code)
        """

    @abstractmethod
    async def put_file(self, local_path: str, remote_path: str) -> None:
        """Upload a file to the remote server."""

    @abstractmethod
    async def get_file(self, remote_path: str, local_path: str) -> None:
        """Download a file from the remote server."""

    @abstractmethod
    async def mkdir(self, path: str) -> None:
        """Create a directory on the remote server."""

    @abstractmethod
    async def chmod(self, path: str, mode: str) -> None:
        """Change file permissions on the remote server."""

    @abstractmethod
    async def test_connection(self) -> bool:
        """Test SSH connection to the server."""

    @property
    @abstractmethod
    def connected(self) -> bool:
        """Whether the client is currently connected."""


class MockSSHClient(SSHClient):
    """Mock SSH client for testing without a real server."""

    def __init__(self) -> None:
        self._connected = False
        self._command_count = 0
        self._file_transfers = 0
        self._fs: dict[str, str] = {}  # remote_path -> content
        self._permissions: dict[str, str] = {}

    async def connect(self, host: str, port: int = 22, user: str = "root",
                      key: str | None = None) -> bool:
        self._connected = True
        self._host = host
        self._port = port
        self._user = user
        self._key = key
        logger.info(f"MockSSH connected to {host}:{port} as {user}")
        return True

    async def disconnect(self) -> None:
        self._connected = False
        logger.info("MockSSH disconnected")

    async def exec_command(self, command: str) -> tuple[str, str, int]:
        if not self._connected:
            raise RuntimeError("SSH not connected")
        self._command_count += 1
        # Simulate command execution based on command content
        cmd = command.strip().lower()

        if "nvcc --version" in cmd or "nvidia-smi" in cmd:
            stdout = "NVIDIA-SMI 535.154.05 Driver Version: 535.154.05 CUDA Version: 12.2"
            stderr = ""
            returncode = 0
        elif "pip show" in cmd:
            pkg = cmd.split("pip show ")[1].split(" ")[0] if "pip show " in cmd else "bittensor"
            if pkg == "bittensor":
                stdout = "Name: bittensor\nVersion: 8.2.5\nSummary: The Bittensor framework\n"
            elif pkg == "subnet-dep":
                stdout = "Name: subnet-dep\nVersion: 1.0.0\n"
            else:
                stdout = f"Package {pkg} not found"
                returncode = 1
            stderr = ""
            returncode = 0 if pkg in ("bittensor", "subnet-dep") else 1
        elif "docker run" in cmd and "nvidia" in cmd:
            stdout = "2024-01-01 00:00:00 INFO nvidia-smi 535.154.05 Driver Version: 535.154.05 CUDA Version: 12.2"
            stderr = ""
            returncode = 0
        elif "apt-get" in cmd or "apt install" in cmd:
            stdout = f"Installing package via apt: {command}"
            stderr = ""
            returncode = 0
        elif "huggingface-cli" in cmd or "huggingface" in cmd:
            stdout = "Model downloaded successfully: /tmp/models/test-model\n"
            stderr = ""
            returncode = 0
        elif "aws" in cmd or "wget" in cmd:
            stdout = "Download completed: /tmp/models/test-model\n"
            stderr = ""
            returncode = 0
        elif "chmod" in cmd:
            stdout = ""
            stderr = ""
            returncode = 0
        elif "mkdir" in cmd:
            # Extract path from mkdir command
            if "/tmp" in command or "/app" in command:
                stdout = f"Created directory: {command}"
                stderr = ""
                returncode = 0
            else:
                stdout = ""
                stderr = ""
                returncode = 0
        else:
            stdout = f"Command executed: {command}"
            stderr = ""
            returncode = 0

        logger.debug(f"MockSSH exec: {command} -> rc={returncode}")
        return stdout, stderr, returncode

    async def put_file(self, local_path: str, remote_path: str) -> None:
        if not self._connected:
            raise RuntimeError("SSH not connected")
        self._file_transfers += 1
        # Read local file content
        try:
            with open(local_path) as f:
                content = f.read()
            self._fs[remote_path] = content
            logger.debug(f"MockSSH put_file: {local_path} -> {remote_path}")
        except FileNotFoundError:
            logger.error(f"Local file not found: {local_path}")
            raise

    async def get_file(self, remote_path: str, local_path: str) -> None:
        if not self._connected:
            raise RuntimeError("SSH not connected")
        content = self._fs.get(remote_path, "")
        with open(local_path, "w") as f:
            f.write(content)
        logger.debug(f"MockSSH get_file: {remote_path} -> {local_path}")

    async def mkdir(self, path: str) -> None:
        if not self._connected:
            raise RuntimeError("SSH not connected")
        # Track directory creation
        logger.debug(f"MockSSH mkdir: {path}")

    async def chmod(self, path: str, mode: str) -> None:
        if not self._connected:
            raise RuntimeError("SSH not connected")
        self._permissions[path] = mode
        logger.debug(f"MockSSH chmod: {path} -> {mode}")

    async def test_connection(self) -> bool:
        return self._connected

    @property
    def connected(self) -> bool:
        return self._connected
