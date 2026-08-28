"""
Analyzer Worker — Phase 4 (Subnet Analyzer).

Drives `AnalyzerService.analyze_subnet` for every known netuid on each tick.
For each netuid, the worker resolves the GitHub repo (via curated dict +
env overrides), fetches 6 raw files concurrently, parses them into a
deployment profile, and persists `Repository` + `SubnetRequirement` rows.

Mock mode is the default; the GitHub client only activates when
`DEPLOYMENT_MODE == "production"` AND `GITHUB_TOKEN` is set, so tests + dev
never hit the network.
"""
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.workers.base import BaseWorker, RetryConfig, StructuredLogger
from app.services.subnet_service import SubnetService
from app.services.analyzer_service import AnalyzerService
from app.clients.github import create_github_file_fetcher


class AnalyzerWorker(BaseWorker):
    """Fetches each subnet's GitHub repo and persists deployment requirements."""

    def __init__(
        self,
        interval_seconds: float = 86400.0,  # 24h — repos don't change often
        config: Optional[Dict[str, Any]] = None,
        db: Optional[AsyncSession] = None,
    ):
        retry_config = RetryConfig(
            max_attempts=3,
            base_delay=2.0,
            max_delay=30.0,
        )
        super().__init__(
            name="analyzer",
            interval_seconds=interval_seconds,
            retry_config=retry_config,
        )
        self.config = config or {}
        self.logger = StructuredLogger("worker.analyzer")
        self.db = db
        self._subnets: Optional[SubnetService] = SubnetService(db) if db is not None else None
        self._fetcher = create_github_file_fetcher()
        self._analyzer = AnalyzerService(fetcher=self._fetcher)

    async def run(self) -> None:
        """Resolve each netuid → analyze → persist (Repository + SubnetRequirement)."""
        self.logger.info("Starting analyzer cycle")

        if self._subnets is None:
            self.logger.warning("Analyzer worker invoked without a DB session; nothing to do.")
            return

        try:
            netuids = await self._subnets.get_known_netuids()
        except Exception as e:
            self.logger.error(f"Failed to list known netuids: {e}")
            return

        analyzed = 0
        skipped = 0
        errors: List[str] = []
        confidence_sum = 0.0
        confidence_count = 0

        for netuid in netuids:
            try:
                result = await self._analyzer.analyze_subnet(netuid, fetcher=self._fetcher)
                if result is None:
                    # No repo mapping for this netuid.
                    skipped += 1
                    continue
                repository, requirement = result
                persisted = await self._subnets.upsert_repository(repository)
                # Now that the Repository has an id, link the requirement to it.
                requirement.repository_id = persisted.id
                await self._subnets.upsert_requirement(requirement)
                analyzed += 1
                if requirement.extraction_confidence is not None:
                    confidence_sum += float(requirement.extraction_confidence)
                    confidence_count += 1
            except Exception as e:
                errors.append(f"netuid={netuid}: {e}")

        avg_confidence = (confidence_sum / confidence_count) if confidence_count else 0.0
        self.logger.info(
            f"analyzer_complete analyzed={analyzed} skipped={skipped} "
            f"avg_confidence={avg_confidence:.2f} errors={len(errors)}"
        )
        if errors:
            for err in errors:
                self.logger.error(f"analyzer_error {err}")


def create_analyzer_worker(
    interval_seconds: float = 86400.0,
    config: Optional[Dict[str, Any]] = None,
    db: Optional[AsyncSession] = None,
) -> AnalyzerWorker:
    """Create a configured AnalyzerWorker instance."""
    return AnalyzerWorker(interval_seconds=interval_seconds, config=config, db=db)
