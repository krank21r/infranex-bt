"""
Tests for the Phase 4 AnalyzerService.

Pins the deterministic, explainable contract of the parser:
- resolve_repo: known netuid -> (owner, repo, branch); unknown -> None; override > default.
- extract_requirements: each field has a source-specific confidence; aggregate is the
  mean of matched confidences; empty inputs -> 0.0.
- analyze_subnet: orchestrates fetch + parse end-to-end; returns ORM rows.

Pure Python + a fake fetcher. No DB, no network.
"""
import pytest

from app.clients.github import FakeGitHubFileFetcher
from app.services.analyzer_service import (
    DEFAULT_SUBNET_REPOS,
    AnalyzerService,
    ExtractedRequirements,
)


def _make_service() -> AnalyzerService:
    return AnalyzerService(fetcher=FakeGitHubFileFetcher())


# ---------- resolve_repo ----------


def test_resolve_repo_returns_default_for_known_netuid():
    svc = _make_service()
    assert svc.resolve_repo(1) == ("macrocosm-os", "text-prompting", "main")
    assert svc.resolve_repo(3) == ("macrocosm-os", "image-alchemy", "main")
    assert svc.resolve_repo(64) == ("macrocosm-os", "finetune", "main")


def test_resolve_repo_returns_none_for_unknown_netuid():
    svc = _make_service()
    assert svc.resolve_repo(999) is None


def test_resolve_repo_override_takes_precedence(monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(
        settings,
        "ANALYZER_REPO_OVERRIDES",
        '{"1": "custom-org/custom-repo", "3": "another/repo"}',
        raising=False,
    )
    svc = _make_service()
    assert svc.resolve_repo(1) == ("custom-org", "custom-repo", "main")
    # Netuid 3 came from the override, not the default.
    assert svc.resolve_repo(3) == ("another", "repo", "main")
    # Netuid 64 falls back to the default (no override).
    assert svc.resolve_repo(64) == DEFAULT_SUBNET_REPOS[64]


def test_resolve_repo_invalid_json_falls_back_to_defaults(monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "ANALYZER_REPO_OVERRIDES", "{not json", raising=False)
    svc = _make_service()
    assert svc.resolve_repo(1) == ("macrocosm-os", "text-prompting", "main")


# ---------- extract_requirements (pure parser) ----------


def test_extract_python_version_from_setup_py():
    svc = _make_service()
    setup_py = 'from setuptools import setup\nsetup(name="x", python_requires=">=3.10")\n'
    result = svc.extract_requirements("", "", "", "", setup_py, "")
    assert isinstance(result, ExtractedRequirements)
    assert result.python_version is not None
    assert result.python_version.value == "3.10"
    assert result.python_version.confidence == 0.9


def test_extract_cuda_version_from_dockerfile():
    svc = _make_service()
    dockerfile = "FROM nvidia/cuda:12.1.0-base\nRUN pip install x\n"
    result = svc.extract_requirements("", "", "", "", "", dockerfile)
    assert result.cuda_version is not None
    assert result.cuda_version.value == "12.1.0"
    assert result.cuda_version.confidence == 0.95


def test_extract_min_vram_from_readme():
    svc = _make_service()
    readme = "## Hardware\nRequires 24GB VRAM\n"
    result = svc.extract_requirements(readme, "", "", "", "", "")
    assert result.min_vram_gb is not None
    assert result.min_vram_gb.value == 24.0
    assert result.min_vram_gb.confidence == 0.5


def test_extract_pytorch_version_from_requirements_txt():
    svc = _make_service()
    req = "torch==2.1.0\ntransformers==4.35.0\n"
    result = svc.extract_requirements("", req, "", "", "", "")
    assert result.pytorch_version is not None
    assert result.pytorch_version.value == "2.1.0"
    assert result.pytorch_version.confidence == 0.9


def test_extract_returns_zero_confidence_when_all_inputs_empty():
    svc = _make_service()
    result = svc.extract_requirements("", "", "", "", "", "")
    # All 16 fields None...
    none_fields = [
        result.python_version, result.cuda_version, result.pytorch_version,
        result.min_vram_gb, result.recommended_gpu, result.ram_gb,
        result.cpu_cores, result.storage_gb, result.docker_required,
        result.nvidia_runtime_required, result.ports, result.env_variables,
        result.startup_command, result.miner_command, result.dependencies,
        result.raw_requirements,
    ]
    assert all(f is None for f in none_fields)
    # ...and aggregate confidence is 0.0.
    assert result.extraction_confidence == 0.0


# ---------- analyze_subnet (orchestration) ----------


@pytest.mark.asyncio
async def test_analyze_subnet_known_netuid_returns_orm_rows():
    svc = _make_service()
    result = await svc.analyze_subnet(1, fetcher=FakeGitHubFileFetcher())
    assert result is not None
    repository, requirement = result
    # Repository row populated.
    assert repository.netuid == 1
    assert repository.url == "https://github.com/macrocosm-os/text-prompting"
    assert repository.analysis_status == "complete"
    # Requirement row has at least the cuda + pytorch + python from the fixtures.
    assert requirement.cuda_version == "12.1.0"
    assert requirement.pytorch_version == "2.1.0"
    assert requirement.python_version == "3.10"
    # Confidence is strictly positive and bounded.
    assert 0.0 < requirement.extraction_confidence <= 1.0


@pytest.mark.asyncio
async def test_analyze_subnet_unknown_netuid_returns_none():
    svc = _make_service()
    result = await svc.analyze_subnet(999, fetcher=FakeGitHubFileFetcher())
    assert result is None
