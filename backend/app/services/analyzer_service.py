"""
Subnet Analyzer service — Phase 4.

Resolves each netuid to a GitHub repo, fetches a small set of raw files
(README, requirements.txt, pyproject.toml, environment.yml, setup.py, Dockerfile),
parses them into a deployment profile, and returns ORM-ready Repository +
SubnetRequirement rows. No DB writes here — the worker owns the transaction.

Confidence model: every extracted field carries its own per-source confidence
(setup.py > Dockerfile > README). The aggregate `extraction_confidence` is
the mean of per-field confidences that were actually matched. Empty inputs
yield confidence 0.0 and all-None fields.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass

from app.clients.github import GitHubFileFetcher
from app.core.config import settings
from app.models import Repository, SubnetRequirement

logger = logging.getLogger(__name__)


# Curated map for the 3 fake subnets the rest of the platform already uses.
# Real production subnets come from ANALYZER_REPO_OVERRIDES (env JSON).
DEFAULT_SUBNET_REPOS: dict[int, tuple[str, str, str]] = {
    1: ("macrocosm-os", "text-prompting", "main"),
    3: ("macrocosm-os", "image-alchemy", "main"),
    64: ("macrocosm-os", "finetune", "main"),
}

# Files we always try to fetch. (path, kind) — kind groups which parser section runs.
FETCH_TARGETS: list[tuple[str, str]] = [
    ("README.md", "readme"),
    ("requirements.txt", "requirements_txt"),
    ("pyproject.toml", "pyproject"),
    ("environment.yml", "environment_yml"),
    ("setup.py", "setup_py"),
    ("Dockerfile", "dockerfile"),
]

README_MAX_CHARS = 4096  # truncate to keep DB rows bounded


@dataclass
class ExtractedField:
    """One extracted field with its own source-derived confidence."""
    value: object
    confidence: float


@dataclass
class ExtractedRequirements:
    """All 17 SubnetRequirement fields as Optional[ExtractedField]."""
    python_version: ExtractedField | None = None
    cuda_version: ExtractedField | None = None
    pytorch_version: ExtractedField | None = None
    min_vram_gb: ExtractedField | None = None
    recommended_gpu: ExtractedField | None = None
    ram_gb: ExtractedField | None = None
    cpu_cores: ExtractedField | None = None
    storage_gb: ExtractedField | None = None
    docker_required: ExtractedField | None = None
    nvidia_runtime_required: ExtractedField | None = None
    ports: ExtractedField | None = None
    env_variables: ExtractedField | None = None
    startup_command: ExtractedField | None = None
    miner_command: ExtractedField | None = None
    dependencies: ExtractedField | None = None
    raw_requirements: ExtractedField | None = None
    extraction_confidence: float = 0.0


class AnalyzerService:
    """Orchestrates repo resolution + fetch + parse. Stateless."""

    def __init__(self, fetcher: GitHubFileFetcher | None = None) -> None:
        self.fetcher = fetcher

    # ---------- 1. Repo resolution ----------

    def _parse_overrides(self) -> dict[int, tuple[str, str, str]]:
        """Parse ANALYZER_REPO_OVERRIDES (JSON: {"1": "owner/repo", ...})."""
        raw = settings.ANALYZER_REPO_OVERRIDES or ""
        if not raw.strip():
            return {}
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            logger.warning("analyzer_overrides_invalid_json err=%s", e)
            return {}
        out: dict[int, tuple[str, str, str]] = {}
        for k, v in (data or {}).items():
            try:
                netuid = int(k)
            except (TypeError, ValueError):
                continue
            if isinstance(v, str) and "/" in v:
                owner, repo = v.split("/", 1)
                out[netuid] = (owner.strip(), repo.strip(), "main")
        return out

    def resolve_repo(self, netuid: int) -> tuple[str, str, str] | None:
        """Return (owner, repo, branch) or None if no mapping."""
        overrides = self._parse_overrides()
        if netuid in overrides:
            return overrides[netuid]
        return DEFAULT_SUBNET_REPOS.get(netuid)

    # ---------- 2. Parsing (pure, regex-only) ----------

    @staticmethod
    def _parse_python_version(setup_py: str, environment_yml: str, pyproject: str) -> ExtractedField | None:
        m = re.search(r'python_requires\s*=\s*["\']>=\s*([0-9.]+)', setup_py)
        if m:
            return ExtractedField(value=m.group(1), confidence=0.9)
        m = re.search(r"-\s*python\s*=\s*([0-9.]+)", environment_yml)
        if m:
            return ExtractedField(value=m.group(1), confidence=0.7)
        m = re.search(r'python\s*=\s*["\']>=\s*([0-9.]+)', pyproject)
        if m:
            return ExtractedField(value=m.group(1), confidence=0.5)
        return None

    @staticmethod
    def _parse_cuda_version(dockerfile: str) -> ExtractedField | None:
        m = re.search(r"FROM\s+nvidia/cuda:([0-9.]+)", dockerfile)
        if m:
            return ExtractedField(value=m.group(1), confidence=0.95)
        return None

    @staticmethod
    def _parse_pytorch_version(requirements_txt: str, pyproject: str) -> ExtractedField | None:
        m = re.search(r"^torch\s*([<>=~!]=+|=)\s*([0-9.]+)", requirements_txt, re.MULTILINE)
        if m:
            return ExtractedField(value=m.group(2), confidence=0.9)
        m = re.search(r'torch\s*=\s*["\']\^?([0-9.]+)', pyproject)
        if m:
            return ExtractedField(value=m.group(1), confidence=0.9)
        return None

    @staticmethod
    def _parse_vram(readme: str) -> ExtractedField | None:
        patterns = [
            r"(?:min(?:imum)?\s*(?:vram|gpu memory)[^0-9]*?|requires?\s+)([0-9]+)\s*gb",
            r"([0-9]+)\s*gb\s+vram",
            r"vram[^0-9]*?([0-9]+)\s*gb",
        ]
        for pat in patterns:
            m = re.search(pat, readme, re.IGNORECASE)
            if m:
                try:
                    return ExtractedField(value=float(m.group(1)), confidence=0.5)
                except ValueError:
                    continue
        return None

    @staticmethod
    def _parse_recommended_gpu(readme: str) -> ExtractedField | None:
        m = re.search(r"(?:recommended\s+gpu|gpu)[:\s]+(NVIDIA\s+[A-Za-z0-9 ]+?)(?:\n|$)", readme, re.IGNORECASE)
        if m:
            return ExtractedField(value=m.group(1).strip(), confidence=0.4)
        return None

    @staticmethod
    def _parse_ram(readme: str) -> ExtractedField | None:
        m = re.search(r"\b(?:ram|memory)[:\s]+([0-9]+)\s*gb", readme, re.IGNORECASE)
        if m:
            try:
                return ExtractedField(value=float(m.group(1)), confidence=0.3)
            except ValueError:
                return None
        return None

    @staticmethod
    def _parse_cpu(readme: str) -> ExtractedField | None:
        m = re.search(r"cpu\s*cores?[:\s]+([0-9]+)", readme, re.IGNORECASE)
        if m:
            try:
                return ExtractedField(value=int(m.group(1)), confidence=0.3)
            except ValueError:
                return None
        return None

    @staticmethod
    def _parse_storage(readme: str) -> ExtractedField | None:
        m = re.search(r"storage[:\s]+([0-9]+)\s*gb", readme, re.IGNORECASE)
        if m:
            try:
                return ExtractedField(value=float(m.group(1)), confidence=0.3)
            except ValueError:
                return None
        return None

    @staticmethod
    def _parse_docker_required(readme: str, dockerfile: str) -> ExtractedField | None:
        if re.search(r"FROM\s+nvidia/cuda", dockerfile):
            return ExtractedField(value=True, confidence=0.7)
        if re.search(r"\bdocker\b", readme, re.IGNORECASE):
            return ExtractedField(value=True, confidence=0.7)
        return None

    @staticmethod
    def _parse_nvidia_runtime(dockerfile: str) -> ExtractedField | None:
        if re.search(r"FROM\s+nvidia/cuda", dockerfile):
            return ExtractedField(value=True, confidence=0.9)
        return None

    @staticmethod
    def _parse_ports(dockerfile: str) -> ExtractedField | None:
        ports: list[int] = []
        for m in re.finditer(r"EXPOSE\s+([0-9]+)", dockerfile):
            try:
                ports.append(int(m.group(1)))
            except ValueError:
                continue
        if ports:
            return ExtractedField(value=sorted(set(ports)), confidence=0.9)
        return None

    @staticmethod
    def _parse_env(dockerfile: str) -> ExtractedField | None:
        envs: dict[str, str] = {}
        for m in re.finditer(r"^\s*ENV\s+([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$", dockerfile, re.MULTILINE):
            envs[m.group(1)] = m.group(2).strip().strip("\"'")
        if envs:
            return ExtractedField(value=envs, confidence=0.9)
        return None

    @staticmethod
    def _parse_commands(readme: str) -> tuple[ExtractedField | None, ExtractedField | None]:
        startup: ExtractedField | None = None
        miner: ExtractedField | None = None
        m = re.search(r"##\s*(?:Getting Started|Running)[\s\S]*?```(?:bash|sh)?\s*\n([^`]+?)\n```", readme, re.IGNORECASE)
        if m:
            cmd = m.group(1).strip()
            startup = ExtractedField(value=cmd, confidence=0.4)
            # If the command mentions "miner", treat as miner command too.
            if "miner" in cmd.lower():
                miner = ExtractedField(value=cmd, confidence=0.4)
        return startup, miner

    @staticmethod
    def _parse_dependencies(requirements_txt: str) -> ExtractedField | None:
        if not requirements_txt.strip():
            return None
        deps: dict[str, str] = {}
        for line in requirements_txt.splitlines():
            line = line.strip()
            if not line or line.startswith(("#", "-")):
                continue
            if "==" in line:
                name, _, ver = line.partition("==")
                deps[name.strip()] = ver.strip()
            elif ">=" in line:
                name, _, ver = line.partition(">=")
                deps[name.strip()] = ">=" + ver.strip()
            else:
                deps[line] = ""
        if deps:
            return ExtractedField(value=deps, confidence=0.9)
        return None

    @staticmethod
    def _parse_raw_requirements(requirements_txt: str) -> ExtractedField | None:
        if requirements_txt:
            return ExtractedField(value={"text": requirements_txt}, confidence=1.0)
        return None

    @classmethod
    def extract_requirements(
        cls,
        readme: str,
        requirements_txt: str,
        pyproject: str,
        environment_yml: str,
        setup_py: str,
        dockerfile: str,
    ) -> ExtractedRequirements:
        startup, miner = cls._parse_commands(readme)
        fields: dict[str, ExtractedField | None] = {
            "python_version": cls._parse_python_version(setup_py, environment_yml, pyproject),
            "cuda_version": cls._parse_cuda_version(dockerfile),
            "pytorch_version": cls._parse_pytorch_version(requirements_txt, pyproject),
            "min_vram_gb": cls._parse_vram(readme),
            "recommended_gpu": cls._parse_recommended_gpu(readme),
            "ram_gb": cls._parse_ram(readme),
            "cpu_cores": cls._parse_cpu(readme),
            "storage_gb": cls._parse_storage(readme),
            "docker_required": cls._parse_docker_required(readme, dockerfile),
            "nvidia_runtime_required": cls._parse_nvidia_runtime(dockerfile),
            "ports": cls._parse_ports(dockerfile),
            "env_variables": cls._parse_env(dockerfile),
            "startup_command": startup,
            "miner_command": miner,
            "dependencies": cls._parse_dependencies(requirements_txt),
            "raw_requirements": cls._parse_raw_requirements(requirements_txt),
        }
        matched = [f.confidence for f in fields.values() if f is not None]
        confidence = (sum(matched) / len(matched)) if matched else 0.0
        return ExtractedRequirements(extraction_confidence=confidence, **fields)

    # ---------- 3. Orchestration ----------

    async def analyze_subnet(
        self,
        netuid: int,
        fetcher: GitHubFileFetcher | None = None,
    ) -> tuple[Repository, SubnetRequirement] | None:
        """Resolve + fetch + parse. Returns (Repository, SubnetRequirement) or None."""
        f = fetcher or self.fetcher
        if f is None:
            raise ValueError("AnalyzerService.analyze_subnet needs a fetcher")

        resolved = self.resolve_repo(netuid)
        if resolved is None:
            return None
        owner, repo, branch = resolved

        # Fetch all 6 files concurrently; missing files -> "".
        import asyncio

        async def _fetch(path: str) -> str:
            try:
                return await f.fetch_raw(owner, repo, branch, path)
            except Exception as e:
                logger.warning("analyzer_fetch_failed netuid=%s path=%s err=%s", netuid, path, e)
                return ""

        results = await asyncio.gather(*[_fetch(p) for p, _ in FETCH_TARGETS])
        files = {kind: body for (path, kind), body in zip(FETCH_TARGETS, results)}

        extracted = self.extract_requirements(
            readme=files["readme"],
            requirements_txt=files["requirements_txt"],
            pyproject=files["pyproject"],
            environment_yml=files["environment_yml"],
            setup_py=files["setup_py"],
            dockerfile=files["dockerfile"],
        )

        repo_url = f"https://github.com/{owner}/{repo}"
        repository = Repository(
            netuid=netuid,
            url=repo_url,
            branch=branch,
            analysis_status="complete",
            readme_content=(files["readme"] or "")[:README_MAX_CHARS],
        )

        # Build SubnetRequirement, copying each field's value (or None) into the ORM column.
        requirement = SubnetRequirement(
            netuid=netuid,
            python_version=_val(extracted.python_version),
            cuda_version=_val(extracted.cuda_version),
            pytorch_version=_val(extracted.pytorch_version),
            min_vram_gb=_val(extracted.min_vram_gb),
            recommended_gpu=_val(extracted.recommended_gpu),
            ram_gb=_val(extracted.ram_gb),
            cpu_cores=_val(extracted.cpu_cores),
            storage_gb=_val(extracted.storage_gb),
            docker_required=_val(extracted.docker_required),
            nvidia_runtime_required=_val(extracted.nvidia_runtime_required),
            ports=_val(extracted.ports),
            env_variables=_val(extracted.env_variables),
            startup_command=_val(extracted.startup_command),
            miner_command=_val(extracted.miner_command),
            dependencies=_val(extracted.dependencies),
            raw_requirements=_val(extracted.raw_requirements),
            extraction_confidence=extracted.extraction_confidence,
        )
        return repository, requirement


def _val(field: ExtractedField | None):
    """Unwrap an ExtractedField to its value, or None if not extracted."""
    return None if field is None else field.value
