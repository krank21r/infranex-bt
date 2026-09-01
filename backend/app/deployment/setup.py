"""
Setup automation for deployment provisioning.

Generates Dockerfiles and startup scripts from requirement snapshots,
and validates server / requirement compatibility.
"""
from __future__ import annotations

import textwrap
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class CompatibilityResult:
    compatible: bool
    server_id: str
    requirement_hash: str
    missing_capabilities: list[str]
    warnings: list[str]
    details: dict[str, Any]


def _requirement_hash(requirements: dict[str, Any]) -> str:
    parts = [
        str(requirements.get("min_vram_gb", "")),
        str(requirements.get("python_version", "")),
        str(requirements.get("docker_required", "")),
        str(requirements.get("nvidia_runtime_required", "")),
        str(requirements.get("recommended_gpu", "")),
    ]
    return "|".join(parts)


def validate_compatibility(
    server: dict[str, Any],
    requirements: dict[str, Any],
) -> CompatibilityResult:
    """Compare server specs against requirement constraints.

    Returns a structured result. `compatible` is False if any hard
    constraint is violated. Soft mismatches are collected as warnings.
    """
    missing: list[str] = []
    warnings: list[str] = []

    min_vram = requirements.get("min_vram_gb")
    if min_vram is not None:
        server_vram = server.get("vram_gb") or 0.0
        if server_vram < float(min_vram):
            missing.append(f"vram_gb={server_vram} < required {min_vram}")

    if requirements.get("docker_required") and not server.get("docker_supported"):
        missing.append("docker_required but not supported")

    if requirements.get("nvidia_runtime_required"):
        if "nvidia" not in (server.get("gpu_model") or "").lower():
            missing.append("nvidia_runtime_required but gpu is not nvidia")

    return CompatibilityResult(
        compatible=len(missing) == 0,
        server_id=str(server.get("id") or server.get("provider_instance_id") or "unknown"),
        requirement_hash=_requirement_hash(requirements),
        missing_capabilities=missing,
        warnings=warnings,
        details={
            "server_specs": server,
            "requirements": requirements,
        },
    )


def generate_setup_script(requirements: dict[str, Any]) -> str:
    """Produce a Dockerfile + entrypoint script from requirements.

    The output is a single shell script string that:
      1. Writes a Dockerfile to /tmp/miner/Dockerfile
      2. Builds and runs the container
    """
    python_version = requirements.get("python_version") or "3.10"
    miner_command = requirements.get("miner_command") or "python -m miner.run"
    startup_command = requirements.get("startup_command") or miner_command
    docker_required = requirements.get("docker_required", True)
    nvidia_runtime = requirements.get("nvidia_runtime_required", True)
    ports = requirements.get("ports") or [8091]

    dockerfile_lines = [
        f"FROM python:{python_version}",
        "WORKDIR /app",
        "COPY requirements.txt .",
        "RUN pip install --no-cache-dir -r requirements.txt",
        "COPY . .",
        "EXPOSE {}".format(" ".join(str(p) for p in ports)),
    ]

    if docker_required and nvidia_runtime:
        dockerfile_lines.insert(1, "FROM nvidia/cuda:12.2.0-runtime-ubuntu22.04 AS base")
        dockerfile_lines.insert(2, "FROM base")

    dockerfile = "\n".join(dockerfile_lines)

    entrypoint = textwrap.dedent(
        """
        #!/usr/bin/env bash
        set -euo pipefail
        mkdir -p /tmp/miner
        cat > /tmp/miner/Dockerfile <<'EOF'
        {dockerfile}
        EOF
        docker build -t miner-image /tmp/miner
        docker run --rm \\
        {docker_flags}
          -p {ports} \\
          miner-image \\
          {startup_command}
        """
    ).strip()

    docker_flags = ""
    if nvidia_runtime:
        docker_flags += "  --gpus all \\\n"

    return entrypoint.format(
        dockerfile=dockerfile,
        docker_flags=docker_flags,
        ports=" ".join(str(p) for p in ports),
        startup_command=startup_command,
    )
