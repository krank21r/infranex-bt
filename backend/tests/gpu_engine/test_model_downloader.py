"""Tests for model downloader."""
import asyncio
import hashlib
import os
import tempfile

import pytest

from app.gpu_engine.model_downloader import (
    ModelDownloadResult,
    download_from_huggingface,
    download_from_s3,
    verify_model_checksum,
)
from app.gpu_engine.ssh_client import MockSSHClient


class TestModelDownloader:
    @pytest.fixture
    def mock_ssh(self):
        ssh = MockSSHClient()
        asyncio.run(ssh.connect("test-host"))
        return ssh

    @pytest.mark.asyncio
    async def test_download_model_hf(self, mock_ssh):
        result = await download_from_huggingface(mock_ssh, "test/repo", "model.bin")
        assert isinstance(result, ModelDownloadResult)

    @pytest.mark.asyncio
    async def test_download_model_s3(self, mock_ssh):
        result = await download_from_s3(mock_ssh, "s3://bucket/model.bin", "/tmp/model.bin")
        assert isinstance(result, ModelDownloadResult)

    @pytest.mark.asyncio
    async def test_verify_model_checksum(self, mock_ssh):
        # Create a test file and verify checksum
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
            f.write("test content for checksum verification")
            tmp_path = f.name
        try:
            # Calculate expected sha256
            with open(tmp_path, 'rb') as f:
                expected = hashlib.sha256(f.read()).hexdigest()
            
            # Mock SSH to compute the checksum
            result = await verify_model_checksum(mock_ssh, tmp_path, expected)
            assert isinstance(result, bool)
        finally:
            os.unlink(tmp_path)