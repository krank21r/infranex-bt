from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from jinja2 import BaseLoader, Environment

from app.gpu_engine.ssh_client import SSHClient


@dataclass
class ConfigWriteResult:
    success: bool
    message: str = ""
    duration_seconds: float = 0.0


async def write_miner_config(ssh: SSHClient, config: dict[str, Any], template: str = "config.json.j2") -> ConfigWriteResult:
    """Write miner config.json to remote server with Jinja2 templating."""
    start = datetime.now(UTC)
    try:
        from jinja2 import BaseLoader, Environment
        env = Environment(loader=BaseLoader())
        template_obj = env.from_string(template)
        rendered = template_obj.render(config)

        remote_path = "/opt/miner/config.json"
        # Write content directly using heredoc
        await ssh.exec_command(f"cat > {remote_path} << 'EOF'\n{rendered}\nEOF")

        duration = (datetime.now(UTC) - start).total_seconds()
        return ConfigWriteResult(success=True, message="config.json written", duration_seconds=duration)
    except Exception as e:
        duration = (datetime.now(UTC) - start).total_seconds()
        return ConfigWriteResult(success=False, message=str(e), duration_seconds=duration)


async def write_env_file(ssh: SSHClient, env_vars: dict[str, str], template: str = ".env.j2") -> ConfigWriteResult:
    """Write .env file with hotkey, wallet path, etc."""
    start = datetime.now(UTC)
    try:
        env = Environment(loader=BaseLoader())
        template_obj = env.from_string(template)
        rendered = template_obj.render(env_vars)

        remote_path = "/opt/miner/.env"
        await ssh.exec_command(f"cat > {remote_path} << 'EOF'\n{rendered}\nEOF")

        # Make sure it's readable
        await ssh.exec_command(f"chmod 644 {remote_path}")

        duration = (datetime.now(UTC) - start).total_seconds()
        return ConfigWriteResult(success=True, message=".env written", duration_seconds=duration)
    except Exception as e:
        duration = (datetime.now(UTC) - start).total_seconds()
        return ConfigWriteResult(success=False, message=str(e), duration_seconds=duration)


async def write_startup_script(ssh: SSHClient, script_content: str, path: str = "/opt/miner/start.sh") -> ConfigWriteResult:
    """Write start.sh script to remote server."""
    start = datetime.now(UTC)
    try:
        await ssh.exec_command(f"cat > {path} << 'EOF'\n{script_content}\nEOF")
        await ssh.exec_command(f"chmod +x {path}")

        duration = (datetime.now(UTC) - start).total_seconds()
        return ConfigWriteResult(success=True, message="startup script written", duration_seconds=duration)
    except Exception as e:
        duration = (datetime.now(UTC) - start).total_seconds()
        return ConfigWriteResult(success=False, message=str(e), duration_seconds=duration)


async def chmod_executable(ssh: SSHClient, path: str) -> ConfigWriteResult:
    """Make a script executable."""
    start = datetime.now(UTC)
    try:
        await ssh.exec_command(f"chmod +x {path}")
        duration = (datetime.now(UTC) - start).total_seconds()
        return ConfigWriteResult(success=True, duration_seconds=duration)
    except Exception as e:
        duration = (datetime.now(UTC) - start).total_seconds()
        return ConfigWriteResult(success=False, message=str(e), duration_seconds=duration)
