"""
GitHub raw-file fetcher — Phase 4 (Subnet Analyzer).

Mirrors the BittensorClient pattern: ABC + 2 concrete impls + factory
+ module-level singleton. The Real implementation only activates when
`DEPLOYMENT_MODE == "production"` AND `settings.GITHUB_TOKEN` is set;
otherwise the Fake serves canned fixtures so tests and dev never hit
the network.
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod

from app.core.config import settings

logger = logging.getLogger(__name__)

_fetcher: GitHubFileFetcher | None = None


class GitHubFetchError(Exception):
    """Raised when a real GitHub fetch returns non-200 or non-text."""


class GitHubFileFetcher(ABC):
    """Narrow async surface the analyzer service depends on."""

    @abstractmethod
    async def fetch_raw(self, owner: str, repo: str, branch: str, path: str) -> str:
        """Return the file body as a string, or "" if not found (fake) / raise (real)."""
        raise NotImplementedError


class RealGitHubFileFetcher(GitHubFileFetcher):
    """httpx-based fetcher for raw.githubusercontent.com / api.github.com."""

    def __init__(self) -> None:
        import httpx  # local import — production-only path
        token = settings.GITHUB_TOKEN
        headers = {"Accept": "application/vnd.github.raw"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self._client = httpx.AsyncClient(
            base_url=settings.GITHUB_API_BASE,
            headers=headers,
            timeout=settings.ANALYZER_FETCH_TIMEOUT_SECONDS,
        )

    async def fetch_raw(self, owner: str, repo: str, branch: str, path: str) -> str:
        url = f"/repos/{owner}/{repo}/contents/{path}?ref={branch}"
        resp = await self._client.get(url)
        if resp.status_code == 404:
            return ""
        if resp.status_code != 200:
            raise GitHubFetchError(
                f"github_fetch_failed owner={owner} repo={repo} path={path} "
                f"status={resp.status_code}"
            )
        # The api.github.com `contents` endpoint returns base64; raw.githubusercontent.com
        # returns text. The settings.GITHUB_API_BASE picks which one we use; callers
        # can override GITHUB_API_BASE=https://raw.githubusercontent.com to get text.
        ct = resp.headers.get("content-type", "")
        if "application/json" in ct:
            import base64
            data = resp.json()
            if isinstance(data, dict) and "content" in data and data.get("encoding") == "base64":
                return base64.b64decode(data["content"]).decode("utf-8", errors="replace")
        return resp.text

    async def aclose(self) -> None:
        await self._client.aclose()


class FakeGitHubFileFetcher(GitHubFileFetcher):
    """Static fixtures keyed by (owner, repo, path). Returns "" for misses."""

    _FIXTURES: dict[tuple[str, str, str], str] = {
        ("macrocosm-os", "text-prompting", "README.md"): (
            "# text-prompting\n\n"
            "## Hardware\n"
            "Recommended GPU: NVIDIA A100 80GB\n"
            "Min VRAM: 24GB\n"
            "RAM: 64GB\n"
            "CPU cores: 16\n"
            "Storage: 200GB\n\n"
            "## Getting Started\n"
            "docker compose up miner\n"
            "python neurons/miner.py --netuid 1\n"
        ),
        ("macrocosm-os", "text-prompting", "requirements.txt"): (
            "torch==2.1.0\n"
            "transformers==4.35.0\n"
            "bittensor>=9.0.0\n"
        ),
        ("macrocosm-os", "text-prompting", "pyproject.toml"): (
            "[project]\n"
            'name = "text-prompting"\n'
            'python = ">=3.10"\n'
        ),
        ("macrocosm-os", "text-prompting", "environment.yml"): "",
        ("macrocosm-os", "text-prompting", "setup.py"): (
            "from setuptools import setup\n"
            'setup(name="text-prompting", python_requires=">=3.10")\n'
        ),
        ("macrocosm-os", "text-prompting", "Dockerfile"): (
            "FROM nvidia/cuda:12.1.0-base\n"
            "WORKDIR /app\n"
            "COPY requirements.txt .\n"
            "RUN pip install -r requirements.txt\n"
            "EXPOSE 8091\n"
            'ENV TAO_NETWORK=finney\n'
            "COPY . .\n"
            'CMD ["python", "neurons/miner.py"]\n'
        ),
        ("macrocosm-os", "image-alchemy", "README.md"): (
            "# image-alchemy\n\n"
            "## Recommended GPU\n"
            "NVIDIA H100 80GB\n"
            "Requires 40GB VRAM minimum\n"
            "## Running\n"
            "docker run miner --netuid 3\n"
        ),
        ("macrocosm-os", "image-alchemy", "requirements.txt"): "torch==2.2.0\npillow==10.0.0\n",
        ("macrocosm-os", "image-alchemy", "pyproject.toml"): "",
        ("macrocosm-os", "image-alchemy", "environment.yml"): "",
        ("macrocosm-os", "image-alchemy", "setup.py"): "",
        ("macrocosm-os", "image-alchemy", "Dockerfile"): "FROM nvidia/cuda:12.2.0-base\n",
        ("macrocosm-os", "finetune", "README.md"): (
            "# finetune\n\n## Hardware\nMin VRAM: 16GB\nRecommended: RTX 4090\n"
        ),
        ("macrocosm-os", "finetune", "requirements.txt"): "torch==2.0.1\npeft==0.6.0\n",
        ("macrocosm-os", "finetune", "pyproject.toml"): "",
        ("macrocosm-os", "finetune", "environment.yml"): "",
        ("macrocosm-os", "finetune", "setup.py"): "",
        ("macrocosm-os", "finetune", "Dockerfile"): "",
    }

    async def fetch_raw(self, owner: str, repo: str, branch: str, path: str) -> str:
        return self._FIXTURES.get((owner, repo, path), "")


def create_github_file_fetcher(reset: bool = False) -> GitHubFileFetcher:
    """Pick Real vs Fake based on settings. Real needs production + token."""
    global _fetcher
    if reset:
        _fetcher = None
    if _fetcher is not None:
        return _fetcher
    if settings.DEPLOYMENT_MODE == "production" and settings.GITHUB_TOKEN:
        _fetcher = RealGitHubFileFetcher()
    else:
        _fetcher = FakeGitHubFileFetcher()
    logger.info(
        "github_fetcher_selected",
        mode=settings.DEPLOYMENT_MODE,
        token_set=bool(settings.GITHUB_TOKEN),
        type=type(_fetcher).__name__,
    )
    return _fetcher
