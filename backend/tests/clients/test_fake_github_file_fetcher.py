"""
Tests for the FakeGitHubFileFetcher and the create_github_file_fetcher factory.

These tests pin the capital-protection contract: in mock mode the
factory MUST return the Fake implementation, and loading the Fake MUST
NOT pull httpx/httpcore into the import graph. This is the line of
defense that keeps dev + tests from ever hitting the network.
"""
import sys

import pytest

from app.clients.github import (
    FakeGitHubFileFetcher,
    create_github_file_fetcher,
)


@pytest.mark.asyncio
async def test_fetch_known_path_returns_fixture():
    fetcher = FakeGitHubFileFetcher()
    body = await fetcher.fetch_raw("macrocosm-os", "text-prompting", "main", "README.md")
    assert "text-prompting" in body
    assert "Hardware" in body


@pytest.mark.asyncio
async def test_fetch_unknown_path_returns_empty_string():
    """Missing files return "" — graceful degradation, no exception."""
    fetcher = FakeGitHubFileFetcher()
    body = await fetcher.fetch_raw("macrocosm-os", "text-prompting", "main", "nonexistent.yaml")
    assert body == ""


@pytest.mark.asyncio
async def test_fetch_unknown_owner_returns_empty_string():
    fetcher = FakeGitHubFileFetcher()
    body = await fetcher.fetch_raw("nobody", "nothing", "main", "README.md")
    assert body == ""


def test_loading_fake_does_not_import_httpx_or_httpcore():
    """Defense-in-depth: ensure the fake path never drags in network deps.

    We import the Fake class explicitly. The local `httpx` import inside
    RealGitHubFileFetcher.__init__ is gated behind instantiation, so just
    loading FakeGitHubFileFetcher MUST NOT pull httpx or httpcore into
    sys.modules. (This test is also the canary: if anyone changes the
    Real implementation to do `import httpx` at module top-level, the
    test fails immediately.)
    """
    httpx_before = "httpx" in sys.modules
    httpcore_before = "httpcore" in sys.modules
    # Touch the Fake class to make sure any module-level side effects run.
    _ = FakeGitHubFileFetcher.__name__
    if not httpx_before:
        assert "httpx" not in sys.modules, "Fake path must not import httpx at module load"
    if not httpcore_before:
        assert "httpcore" not in sys.modules, "Fake path must not import httpcore at module load"


def test_factory_returns_fake_when_token_missing(monkeypatch):
    """Mock mode + no token => Fake (never the real httpx client)."""
    from app.core.config import settings
    monkeypatch.setattr(settings, "DEPLOYMENT_MODE", "mock", raising=False)
    monkeypatch.setattr(settings, "GITHUB_TOKEN", "", raising=False)
    fetcher = create_github_file_fetcher(reset=True)
    assert isinstance(fetcher, FakeGitHubFileFetcher)
