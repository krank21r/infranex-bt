"""Tests for GPU installer API routes."""
import os
import sys

sys.path.insert(0, r'D:\Infranex BT\infranex-bt\backend')
os.chdir(r'D:\Infranex BT\infranex-bt\backend')

from fastapi import FastAPI
from fastapi.testclient import TestClient

# Create app without database initialization
app = FastAPI()

# Include the GPU engine router
from app.api.routes.gpu_install import router as gpu_install_router

app.include_router(gpu_install_router)

client = TestClient(app)


class TestGPUInstallRoutes:
    def test_install_cuda_endpoint(self):
        response = client.post("/api/gpu-engine/test-server/install-cuda")
        assert response.status_code == 200

    def test_install_docker_endpoint(self):
        response = client.post("/api/gpu-engine/test-server/install-docker")
        assert response.status_code == 200

    def test_install_dependencies_endpoint(self):
        response = client.post("/api/gpu-engine/test-server/install-dependencies",
                               json={"requirements_txt_url": "test"})
        assert response.status_code == 200

    def test_download_model_endpoint(self):
        response = client.post("/api/gpu-engine/test-server/download-model",
                               json={"model_url": "hf://test/repo", "target_path": "/tmp/model"})
        assert response.status_code == 200

    def test_write_config_endpoint(self):
        response = client.post("/api/gpu-engine/test-server/write-config",
                               json={"config": {"hotkey": "0x123"}})
        assert response.status_code == 200

    def test_setup_complete_endpoint(self):
        response = client.post("/api/gpu-engine/test-server/setup-complete")
        assert response.status_code == 200

    def test_setup_status_endpoint(self):
        response = client.get("/api/gpu-engine/test-server/setup-status")
        assert response.status_code == 200