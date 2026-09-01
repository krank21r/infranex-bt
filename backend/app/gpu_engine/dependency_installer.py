from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from app.gpu_engine.ssh_client import SSHClient


@dataclass
class InstalledPackage:
    name: str
    version: str
    summary: str = ""


async def install_python_deps(ssh: SSHClient, requirements_txt_url: str) -> list[InstalledPackage]:
    """pip install from requirements file URL."""
    start = datetime.now(UTC)
    try:
        # Download requirements file first
        await ssh.exec_command(f"pip install -r {requirements_txt_url}")
        # Parse installed packages - in mock mode, return common ones
        # In real implementation, would parse pip output
        packages: list[InstalledPackage] = []

        # Verify key packages were installed
        deps = ["bittensor", "subnet-deps"]
        for pkg in deps:
            result = await verify_installation(ssh, pkg)
            if result:
                packages.append(result)

        (datetime.now(UTC) - start).total_seconds()
        return packages
    except Exception:
        (datetime.now(UTC) - start).total_seconds()
        return []


async def install_bittensor(ssh: SSHClient) -> InstalledPackage:
    """pip install bittensor."""
    start = datetime.now(UTC)
    try:
        _stdout, stderr, rc = await ssh.exec_command("pip install bittensor")
        if rc != 0:
            raise RuntimeError(f"Failed to install bittensor: {stderr}")

        # Get installed version
        version_stdout, _, _ = await ssh.exec_command("pip show bittensor")
        version = version_stdout.strip().split("\n")[1].split(": ")[1] if ":" in version_stdout else "unknown"

        (datetime.now(UTC) - start).total_seconds()
        return InstalledPackage(name="bittensor", version=version)
    except Exception as e:
        (datetime.now(UTC) - start).total_seconds()
        return InstalledPackage(name="bittensor", version="", error=str(e))


async def install_subnet_deps(ssh: SSHClient, netuid: int, repo_url: str) -> list[InstalledPackage]:
    """Clone subnet repo and install its requirements.txt."""
    start = datetime.now(UTC)
    packages: list[InstalledPackage] = []
    try:
        # Clone the repo
        await ssh.exec_command(f"git clone {repo_url} /opt/subnet")
        # Install requirements
        requirements_path = "/opt/subnet/requirements.txt"
        install_cmd = f"pip install -r {requirements_path}"
        _stdout, stderr, rc = await ssh.exec_command(install_cmd)
        if rc != 0:
            raise RuntimeError(f"Failed to install subnet deps: {stderr}")

        # Verify installed packages
        verify_pkgs = ["bittensor", "subnet-dep"]
        for pkg in verify_pkgs:
            result = await verify_installation(ssh, pkg)
            if result:
                packages.append(result)

        (datetime.now(UTC) - start).total_seconds()
        return packages
    except Exception:
        (datetime.now(UTC) - start).total_seconds()
        return []


async def verify_installation(ssh: SSHClient, package: str) -> InstalledPackage | None:
    """pip show <package> - verify package installation."""
    start = datetime.now(UTC)
    try:
        stdout, _stderr, rc = await ssh.exec_command(f"pip show {package}")
        if rc != 0:
            return None

        # Parse the output
        info = {}
        for line in stdout.strip().split("\n"):
            if ":" in line:
                key, val = line.split(":", 1)
                info[key.strip()] = val.strip()

        version = info.get("Version", "")
        summary = info.get("Summary", "")

        (datetime.now(UTC) - start).total_seconds()
        return InstalledPackage(name=package, version=version, summary=summary)
    except Exception:
        (datetime.now(UTC) - start).total_seconds()
        return None
