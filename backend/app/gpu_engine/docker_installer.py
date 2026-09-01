from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from app.gpu_engine.ssh_client import SSHClient


@dataclass
class DockerGPUResult:
    success: bool
    duration_seconds: float = 0.0
    error: str | None = None


async def install_docker(ssh: SSHClient) -> DockerGPUResult:
    """Install Docker CE on Ubuntu 20.04/22.04 or Debian 11/12."""
    start = datetime.now(UTC)
    try:
        commands = [
            "apt-get update",
            "apt-get install -y apt-transport-https ca-certificates curl gnupg2",
            "curl -fsSL https://download.docker.com/linux/ubuntu/gpg | apt-key add -",
            "add-apt-repository \"deb [arch=amd64] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable\"",
            "apt-get update",
            "apt-get install -y docker-ce",
        ]
        for cmd in commands:
            _stdout, stderr, rc = await ssh.exec_command(cmd)
            if rc != 0:
                raise RuntimeError(f"Failed to run: {cmd}\nstderr: {stderr}")

        # Start and enable Docker
        await ssh.exec_command("systemctl start docker")
        await ssh.exec_command("systemctl enable docker")

        duration = (datetime.now(UTC) - start).total_seconds()
        return DockerGPUResult(success=True, duration_seconds=duration)
    except Exception as e:
        duration = (datetime.now(UTC) - start).total_seconds()
        return DockerGPUResult(success=False, duration_seconds=duration, error=str(e))


async def install_nvidia_container_toolkit(ssh: SSHClient) -> DockerGPUResult:
    """Install nvidia-container-toolkit for GPU passthrough to Docker."""
    start = datetime.now(UTC)
    try:
        commands = [
            "curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | apt-key add -",
            "curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | tee /etc/apt/sources.list.d/nvidia-container-toolkit.list",
            "apt-get update",
            "apt-get install -y nvidia-container-toolkit",
            "nvidia-ctk runtime configure --accept-license-key",
            "systemctl restart docker",
        ]
        for cmd in commands:
            _stdout, stderr, rc = await ssh.exec_command(cmd)
            if rc != 0:
                raise RuntimeError(f"Failed to run: {cmd}\nstderr: {stderr}")

        duration = (datetime.now(UTC) - start).total_seconds()
        return DockerGPUResult(success=True, duration_seconds=duration)
    except Exception as e:
        duration = (datetime.now(UTC) - start).total_seconds()
        return DockerGPUResult(success=False, duration_seconds=duration, error=str(e))


async def verify_docker_gpu(ssh: SSHClient) -> DockerGPUResult:
    """Verify Docker can access NVIDIA GPUs."""
    start = datetime.now(UTC)
    try:
        _stdout, stderr, rc = await ssh.exec_command(
            "docker run --rm --gpus all nvidia/cuda:11.0-base nvidia-smi"
        )
        if rc != 0:
            raise RuntimeError(f"Docker GPU verification failed: {stderr}")

        duration = (datetime.now(UTC) - start).total_seconds()
        return DockerGPUResult(success=True, duration_seconds=duration)
    except Exception as e:
        duration = (datetime.now(UTC) - start).total_seconds()
        return DockerGPUResult(success=False, duration_seconds=duration, error=str(e))


async def configure_docker_daemon(ssh: SSHClient) -> DockerGPUResult:
    """Configure Docker daemon to use nvidia as default runtime."""
    start = datetime.now(UTC)
    try:
        # Create daemon config with nvidia runtime
        config_content = '{"default-runtime": "nvidia"}'

        # Write the file directly using exec_command heredoc
        await ssh.exec_command(f"cat > /etc/docker/daemon.json << 'EOF'\n{config_content}\nEOF")

        # Restart Docker daemon
        await ssh.exec_command("systemctl restart docker")

        duration = (datetime.now(UTC) - start).total_seconds()
        return DockerGPUResult(success=True, duration_seconds=duration)
    except Exception as e:
        duration = (datetime.now(UTC) - start).total_seconds()
        return DockerGPUResult(success=False, duration_seconds=duration, error=str(e))
