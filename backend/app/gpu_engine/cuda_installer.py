from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime


@dataclass
class CUDAInstallResult:
    success: bool
    version: str = ""
    duration_seconds: float = 0.0
    error: str | None = None


async def install_cuda_driver(ssh: SSHClient, target_version: str = "12.2") -> CUDAInstallResult:
    """Install NVIDIA CUDA toolkit on Ubuntu 20.04/22.04 or Debian 11/12."""
    start = datetime.now(UTC)
    try:
        # Detect OS and set package manager commands
        # CUDA 12.2 on Ubuntu 22.04
        commands = [
            "apt-get update",
            "apt-get install -y cuda-toolkit-12-2",
        ]
        for cmd in commands:
            stdout, stderr, rc = await ssh.exec_command(cmd)
            if rc != 0:
                raise RuntimeError(f"Failed to run: {cmd}\nstderr: {stderr}")

        # Verify installation
        stdout, stderr, rc = await ssh.exec_command("nvcc --version")
        if rc != 0:
            raise RuntimeError(f"CUDA verification failed: {stderr}")

        version = stdout.strip().split("CUDA Version:")[1].strip() if "CUDA Version:" in stdout else target_version

        duration = (datetime.now(UTC) - start).total_seconds()
        return CUDAInstallResult(success=True, version=version, duration_seconds=duration)
    except Exception as e:
        duration = (datetime.now(UTC) - start).total_seconds()
        return CUDAInstallResult(success=False, version="", duration_seconds=duration, error=str(e))


async def install_nvidia_driver(ssh: SSHClient) -> CUDAInstallResult:
    """Install NVIDIA driver on the server."""
    start = datetime.now(UTC)
    try:
        # Install NVIDIA driver using apt
        commands = [
            "apt-get update",
            "apt-get install -y nvidia-driver-535",
        ]
        for cmd in commands:
            stdout, stderr, rc = await ssh.exec_command(cmd)
            if rc != 0:
                raise RuntimeError(f"Failed to run: {cmd}\nstderr: {stderr}")

        # Verify driver
        _stdout, stderr, rc = await ssh.exec_command("nvidia-smi")
        if rc != 0:
            raise RuntimeError(f"Driver verification failed: {stderr}")

        duration = (datetime.now(UTC) - start).total_seconds()
        return CUDAInstallResult(success=True, duration_seconds=duration)
    except Exception as e:
        duration = (datetime.now(UTC) - start).total_seconds()
        return CUDAInstallResult(success=False, duration_seconds=duration, error=str(e))


async def verify_cuda_installation(ssh: SSHClient) -> CUDAInstallResult:
    """Verify CUDA installation by checking nvcc and nvidia-smi."""
    start = datetime.now(UTC)
    try:
        nvcc_stdout, _, nvcc_rc = await ssh.exec_command("nvcc --version")
        _nvidia_stdout, _, nvidia_rc = await ssh.exec_command("nvidia-smi")

        success = nvcc_rc == 0 and nvidia_rc == 0
        version = ""
        if nvcc_rc == 0:
            # Try nvcc format: "release 12.2, ..."
            if "release " in nvcc_stdout:
                version = nvcc_stdout.strip().split("release ")[1].split(",")[0]
            # Try nvidia-smi format: "CUDA Version: 12.2"
            elif "CUDA Version:" in nvcc_stdout:
                version = nvcc_stdout.strip().split("CUDA Version:")[1].strip().split()[0]
            else:
                version = ""

        duration = (datetime.now(UTC) - start).total_seconds()
        return CUDAInstallResult(
            success=success,
            version=version,
            duration_seconds=duration,
        )
    except Exception as e:
        duration = (datetime.now(UTC) - start).total_seconds()
        return CUDAInstallResult(success=False, version="", duration_seconds=duration, error=str(e))
