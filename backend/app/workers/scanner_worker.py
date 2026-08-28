"""Scanner worker — delegates to DiscoveryService."""
from typing import Any, Dict, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.workers.base import BaseWorker, RetryConfig, StructuredLogger


class ScannerWorker(BaseWorker):
    def __init__(self, interval_seconds=300.0, config=None, db=None):
        retry_config = RetryConfig(max_attempts=3, base_delay=2.0, max_delay=30.0)
        super().__init__(name="scanner", interval_seconds=interval_seconds, retry_config=retry_config)
        self.config = config or {}
        self.db = db
        self.logger = StructuredLogger("worker.scanner")
        self._scan_targets = self.config.get("scan_targets", [])
        self._provider_apis = {}

    async def run(self):
        self.logger.info("scan_cycle_starting")
        if self.db is None:
            raise RuntimeError("ScannerWorker requires a db session")
        from app.clients.bittensor import get_bittensor_client
        from app.services.discovery_service import DiscoveryService
        client = get_bittensor_client()
        discovery = DiscoveryService(self.db, client)
        result = await discovery.run_full_scan()
        self.logger.info("scan_complete", **result)


def create_scanner_worker(interval_seconds=300.0, config=None, db=None):
    return ScannerWorker(interval_seconds=interval_seconds, config=config, db=db)
