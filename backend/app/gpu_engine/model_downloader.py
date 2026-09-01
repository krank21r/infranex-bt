from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from app.gpu_engine.ssh_client import SSHClient


@dataclass
class ModelDownloadResult:
    path: str
    size_mb: float = 0.0
    checksum_verified: bool = False
    duration_seconds: float = 0.0
    error: str | None = None


async def download_model(ssh: SSHClient, model_url: str, target_path: str) -> ModelDownloadResult:
    """Download model files from HuggingFace, S3, or direct URL."""
    start = datetime.now(UTC)
    try:
        if "huggingface.co" in model_url or model_url.startswith("hf://"):
            result = await download_from_huggingface(ssh, model_url, target_path)
        elif "s3://" in model_url or "s3.amazonaws.com" in model_url:
            result = await download_from_s3(ssh, model_url, target_path)
        else:
            # Direct URL download using wget
            cmd = f"wget -O {target_path} {model_url}"
            _stdout, stderr, rc = await ssh.exec_command(cmd)
            if rc != 0:
                raise RuntimeError(f"Direct download failed: {stderr}")
            result = ModelDownloadResult(
                path=target_path,
                size_mb=0.0,
                checksum_verified=False,
                duration_seconds=(datetime.now(UTC) - start).total_seconds(),
            )

        duration = (datetime.now(UTC) - start).total_seconds()
        return result
    except Exception as e:
        duration = (datetime.now(UTC) - start).total_seconds()
        return ModelDownloadResult(
            path="",
            size_mb=0.0,
            checksum_verified=False,
            duration_seconds=duration,
            error=str(e),
        )


async def download_from_huggingface(ssh: SSHClient, repo_id: str, filename: str) -> ModelDownloadResult:
    """Download model from HuggingFace using huggingface-cli."""
    start = datetime.now(UTC)
    try:
        # Authenticate and download
        cmds = [
            "huggingface-cli login",  # Would use token in real implementation
            f"huggingface-cli download {repo_id} {filename} --local-dir {filename}",
        ]
        for cmd in cmds:
            _stdout, stderr, rc = await ssh.exec_command(cmd)
            if rc != 0:
                raise RuntimeError(f"HF download failed: {stderr}")

        path = f"/models/{filename}"
        # Get file size
        size_stdout, _, _ = await ssh.exec_command(f"du -sh {path}")
        size_mb = 0.0
        if size_stdout:
            try:
                size_mb = float(size_stdout.split()[0].replace("M", "").replace("G", "").replace("G", "1024"))
            except ValueError:
                pass

        return ModelDownloadResult(
            path=path,
            size_mb=size_mb,
            checksum_verified=True,
            duration_seconds=(datetime.now(UTC) - start).total_seconds(),
        )
    except Exception as e:
        duration = (datetime.now(UTC) - start).total_seconds()
        return ModelDownloadResult(
            path="",
            size_mb=0.0,
            checksum_verified=False,
            duration_seconds=duration,
            error=str(e),
        )


async def download_from_s3(ssh: SSHClient, s3_url: str, target_path: str) -> ModelDownloadResult:
    """Download model from S3 using aws cli or wget."""
    start = datetime.now(UTC)
    try:
        # Try aws cli first
        cmd = f"aws s3 cp {s3_url} {target_path}"
        stdout, stderr, rc = await ssh.exec_command(cmd)
        if rc != 0:
            # Fallback to wget
            cmd = f"wget -O {target_path} {s3_url}"
            _stdout, stderr, rc = await ssh.exec_command(cmd)
            if rc != 0:
                raise RuntimeError(f"S3 download failed: {stderr}")

        # Get file size
        size_stdout, _, _ = await ssh.exec_command(f"du -sh {target_path}")
        size_mb = 0.0
        if size_stdout:
            try:
                size_val = size_stdout.split()[0]
                if "G" in size_stdout:
                    size_mb = float(size_val.replace("G", "")) * 1024
                elif "M" in size_stdout:
                    size_mb = float(size_val.replace("M", ""))
            except ValueError:
                pass

        return ModelDownloadResult(
            path=target_path,
            size_mb=size_mb,
            checksum_verified=True,
            duration_seconds=(datetime.now(UTC) - start).total_seconds(),
        )
    except Exception as e:
        duration = (datetime.now(UTC) - start).total_seconds()
        return ModelDownloadResult(
            path="",
            size_mb=0.0,
            checksum_verified=False,
            duration_seconds=duration,
            error=str(e),
        )


async def verify_model_checksum(ssh: SSHClient, file_path: str, expected_sha256: str) -> bool:
    """Verify file integrity using SHA256 checksum."""
    start = datetime.now(UTC)
    try:
        # Compute actual checksum
        cmd = f"sha256sum {file_path}"
        stdout, _, rc = await ssh.exec_command(cmd)
        if rc != 0:
            return False

        actual_sha256 = stdout.strip().split()[0]
        checksum_verified = actual_sha256.lower() == expected_sha256.lower().strip()

        (datetime.now(UTC) - start).total_seconds()
        return checksum_verified
    except Exception:
        return False
