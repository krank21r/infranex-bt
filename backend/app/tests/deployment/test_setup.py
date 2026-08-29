"""
Tests for deployment setup automation.
"""

from app.deployment.setup import validate_compatibility, generate_setup_script


def test_validate_compatibility_returns_true_for_matching_server():
    server = {
        "id": "srv-1",
        "provider_instance_id": "mock-srv-0001",
        "gpu_model": "NVIDIA A100",
        "vram_gb": 80.0,
        "docker_supported": True,
    }
    requirements = {
        "min_vram_gb": 24.0,
        "python_version": "3.10",
        "docker_required": True,
        "nvidia_runtime_required": True,
        "recommended_gpu": "A100",
    }
    result = validate_compatibility(server, requirements)
    assert result.compatible is True
    assert result.server_id == "srv-1"
    assert len(result.missing_capabilities) == 0


def test_validate_compatibility_returns_false_for_insufficient_vram():
    server = {
        "id": "srv-1",
        "provider_instance_id": "mock-srv-0001",
        "gpu_model": "RTX 3080",
        "vram_gb": 10.0,
        "docker_supported": True,
    }
    requirements = {
        "min_vram_gb": 24.0,
        "python_version": "3.10",
        "docker_required": True,
        "nvidia_runtime_required": True,
        "recommended_gpu": "A100",
    }
    result = validate_compatibility(server, requirements)
    assert result.compatible is False
    assert any("vram_gb" in msg for msg in result.missing_capabilities)


def test_validate_compatibility_detects_non_nvidia_for_nvidia_requirement():
    server = {
        "id": "srv-1",
        "provider_instance_id": "mock-srv-0001",
        "gpu_model": "AMD MI250",
        "vram_gb": 128.0,
        "docker_supported": True,
    }
    requirements = {
        "min_vram_gb": 24.0,
        "nvidia_runtime_required": True,
    }
    result = validate_compatibility(server, requirements)
    assert result.compatible is False
    assert any("nvidia_runtime_required" in msg for msg in result.missing_capabilities)


def test_generate_setup_script_contains_ports_and_command():
    requirements = {
        "python_version": "3.10",
        "docker_required": True,
        "nvidia_runtime_required": True,
        "ports": [8091, 8092],
        "startup_command": "python -m miner.start",
    }
    script = generate_setup_script(requirements)
    assert "8091" in script
    assert "8092" in script
    assert "miner.start" in script


def test_generate_setup_script_defaults_without_docker():
    requirements = {
        "python_version": "3.9",
        "docker_required": False,
        "nvidia_runtime_required": False,
        "ports": [9000],
        "startup_command": "python main.py",
    }
    script = generate_setup_script(requirements)
    assert "python:3.9" in script
    assert "--gpus" not in script
