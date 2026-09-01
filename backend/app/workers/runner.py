"""
Worker Runner

Manages lifecycle of multiple background workers with:
- Signal handling for graceful shutdown
- Concurrent worker execution
- Health monitoring
- Metrics aggregation
"""

import asyncio
import signal
import sys
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.workers import (
    AnalyzerWorker,
    MarketDataWorker,
    ScannerWorker,
    ScoringWorker,
    create_analyzer_worker,
    create_market_data_worker,
    create_scanner_worker,
    create_scoring_worker,
)
from app.workers.auto_stop_worker import AutoStopWorker, create_auto_stop_worker
from app.workers.base import BaseWorker
from app.workers.recovery_worker import RecoveryWorker, create_recovery_worker


@dataclass
class WorkerConfig:
    """Configuration for a worker instance."""
    worker_class: type
    factory: callable
    interval_seconds: float
    config: dict[str, Any] = field(default_factory=dict)
    enabled: bool = True


@dataclass
class RunnerMetrics:
    """Aggregated metrics for all workers."""
    total_workers: int = 0
    running_workers: int = 0
    healthy_workers: int = 0
    total_runs: int = 0
    total_success: int = 0
    total_failed: int = 0
    worker_metrics: dict[str, dict[str, Any]] = field(default_factory=dict)

    def update_from_worker(self, worker: BaseWorker) -> None:
        metrics = worker.get_metrics()
        self.worker_metrics[worker.name] = metrics
        self.total_runs += metrics["runs_total"]
        self.total_success += metrics["runs_success"]
        self.total_failed += metrics["runs_failed"]
        self.running_workers = sum(1 for m in self.worker_metrics.values() if m["is_running"])
        self.healthy_workers = sum(1 for m in self.worker_metrics.values() if m["is_healthy"])


class WorkerRunner:
    """
    Manages multiple background workers with graceful lifecycle management.

    Features:
    - Signal handling (SIGTERM, SIGINT) for graceful shutdown
    - Concurrent worker execution
    - Health monitoring endpoint
    - Metrics aggregation
    - Configurable worker enable/disable
    """

    def __init__(
        self,
        worker_configs: list[WorkerConfig] | None = None,
        shutdown_timeout: float = 30.0,
        db: AsyncSession | None = None,
    ):
        self.worker_configs = worker_configs or self._default_configs()
        self.shutdown_timeout = shutdown_timeout
        self.db = db
        self._workers: dict[str, BaseWorker] = {}
        self._running = False
        self._shutdown_event = asyncio.Event()
        self._monitor_task: asyncio.Task | None = None
        self.metrics = RunnerMetrics()

    def _default_configs(self) -> list[WorkerConfig]:
        """Default worker configurations from settings."""
        from app.core.config import settings

        return [
            WorkerConfig(
                worker_class=ScannerWorker,
                factory=create_scanner_worker,
                interval_seconds=settings.SCANNER_FAST_INTERVAL_SECONDS,
                config={
                    "scan_targets": ["bittensor_subnets", "gpu_providers"],
                },
                enabled=True,
            ),
            WorkerConfig(
                worker_class=MarketDataWorker,
                factory=create_market_data_worker,
                interval_seconds=60.0,
                config={
                    "price_symbols": ["TAO", "BTC", "ETH", "SOL", "USDT"],
                    "fx_pairs": ["USD/INR"],
                    "cache_ttl_seconds": 120,
                },
                enabled=True,
            ),
            WorkerConfig(
                worker_class=ScoringWorker,
                factory=create_scoring_worker,
                interval_seconds=settings.SCANNER_MEDIUM_INTERVAL_SECONDS,
                config={
                    "scoring_weights": {
                        "roi_weight": 0.4,
                        "risk_weight": 0.2,
                        "liquidity_weight": 0.15,
                        "confidence_weight": 0.15,
                        "diversification_weight": 0.1,
                    },
                    "min_score_threshold": 0.5,
                    "max_opportunities_per_cycle": 50,
                },
                enabled=True,
            ),
            WorkerConfig(
                worker_class=AnalyzerWorker,
                factory=create_analyzer_worker,
                interval_seconds=settings.SCANNER_SLOW_INTERVAL_SECONDS,
                config={},
                enabled=True,
            ),
            WorkerConfig(
                worker_class=AutoStopWorker,
                factory=create_auto_stop_worker,
                interval_seconds=300.0,
                config={
                    "unhealthy_threshold": 2,
                    "degraded_threshold": 5,
                    "max_age_hours": 72,
                },
                enabled=True,
            ),
            WorkerConfig(
                worker_class=RecoveryWorker,
                factory=create_recovery_worker,
                interval_seconds=300.0,
                config={},
                enabled=True,
            ),
        ]

    async def start(self) -> None:
        """Start all enabled workers."""
        if self._running:
            return

        self._running = True
        self._shutdown_event.clear()

        # Setup signal handlers
        self._setup_signal_handlers()

        # Start enabled workers
        for config in self.worker_configs:
            if config.enabled:
                factory_kwargs: dict[str, Any] = {
                    "interval_seconds": config.interval_seconds,
                    "config": config.config,
                }
                # Workers that take a db session pick it up here. Workers
                # that don't (e.g. MarketDataWorker) ignore unknown kwargs
                # only if we filter — for safety we only pass db when the
                # factory is the scanner one, leaving other workers alone.
                if config.factory in (
                    create_scanner_worker,
                    create_scoring_worker,
                    create_analyzer_worker,
                    create_auto_stop_worker,
                    create_recovery_worker,
                ) and self.db is not None:
                    factory_kwargs["db"] = self.db
                worker = config.factory(**factory_kwargs)
                self._workers[worker.name] = worker
                await worker.start()

        self.metrics.total_workers = len(self._workers)

        # Start health monitor
        self._monitor_task = asyncio.create_task(self._health_monitor())

        print(f"Started {len(self._workers)} workers", file=sys.stderr)

    async def stop(self) -> None:
        """Gracefully stop all workers."""
        if not self._running:
            return

        self._running = False
        self._shutdown_event.set()

        # Stop health monitor
        if self._monitor_task:
            self._monitor_task.cancel()
            try:
                await self._monitor_task
            except asyncio.CancelledError:
                pass

        # Stop all workers concurrently
        stop_tasks = [
            worker.stop(timeout=self.shutdown_timeout)
            for worker in self._workers.values()
        ]
        await asyncio.gather(*stop_tasks, return_exceptions=True)

        print("All workers stopped", file=sys.stderr)

    def _setup_signal_handlers(self) -> None:
        """Setup signal handlers for graceful shutdown."""
        loop = asyncio.get_running_loop()

        def signal_handler(sig: signal.Signals) -> None:
            print(f"Received signal {sig.name}, initiating shutdown...", file=sys.stderr)
            asyncio.create_task(self.stop())

        try:
            loop.add_signal_handler(signal.SIGTERM, signal_handler, signal.SIGTERM)
            loop.add_signal_handler(signal.SIGINT, signal_handler, signal.SIGINT)
        except NotImplementedError:
            # Windows doesn't support add_signal_handler
            pass

    async def _health_monitor(self) -> None:
        """Periodic health check and metrics aggregation."""
        while self._running and not self._shutdown_event.is_set():
            try:
                await asyncio.sleep(30)  # Check every 30 seconds

                # Update aggregated metrics
                self.metrics = RunnerMetrics()
                for worker in self._workers.values():
                    self.metrics.update_from_worker(worker)

                # Log health summary
                unhealthy = [
                    name for name, m in self.metrics.worker_metrics.items()
                    if not m["is_healthy"]
                ]
                if unhealthy:
                    print(
                        f"Health check: {len(unhealthy)} unhealthy workers: {unhealthy}",
                        file=sys.stderr
                    )

            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Health monitor error: {e}", file=sys.stderr)

    def get_worker(self, name: str) -> BaseWorker | None:
        """Get a worker by name."""
        return self._workers.get(name)

    def get_all_metrics(self) -> dict[str, Any]:
        """Get aggregated metrics for all workers."""
        return {
            "runner": {
                "total_workers": self.metrics.total_workers,
                "running_workers": self.metrics.running_workers,
                "healthy_workers": self.metrics.healthy_workers,
                "total_runs": self.metrics.total_runs,
                "total_success": self.metrics.total_success,
                "total_failed": self.metrics.total_failed,
                "success_rate": (
                    self.metrics.total_success / self.metrics.total_runs
                    if self.metrics.total_runs > 0 else 0
                ),
            },
            "workers": self.metrics.worker_metrics,
        }

    def is_healthy(self) -> bool:
        """Check if all workers are healthy."""
        return self.metrics.healthy_workers == self.metrics.total_workers

    @asynccontextmanager
    async def lifespan(self):
        """Async context manager for runner lifecycle."""
        await self.start()
        try:
            yield self
        finally:
            await self.stop()


async def run_workers(
    worker_names: list[str] | None = None,
    shutdown_timeout: float = 30.0,
) -> None:
    """
    Convenience function to run workers directly.

    Args:
        worker_names: List of worker names to run (None = all enabled)
        shutdown_timeout: Seconds to wait for graceful shutdown
    """
    runner = WorkerRunner(shutdown_timeout=shutdown_timeout)

    if worker_names:
        # Disable workers not in the list
        for config in runner.worker_configs:
            if config.factory.__name__.replace("create_", "").replace("_worker", "") not in worker_names:
                config.enabled = False

    async with runner.lifespan():
        # Keep running until shutdown
        await runner._shutdown_event.wait()


def create_runner(
    worker_configs: list[WorkerConfig] | None = None,
    shutdown_timeout: float = 30.0,
) -> WorkerRunner:
    """Factory function to create a configured WorkerRunner."""
    return WorkerRunner(worker_configs=worker_configs, shutdown_timeout=shutdown_timeout)


# CLI entry point
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Run Infranex BT background workers")
    parser.add_argument(
        "--workers",
        nargs="+",
        choices=["scanner", "market", "scoring"],
        help="Workers to run (default: all)",
    )
    parser.add_argument(
        "--shutdown-timeout",
        type=float,
        default=30.0,
        help="Graceful shutdown timeout in seconds",
    )
    args = parser.parse_args()

    asyncio.run(run_workers(worker_names=args.workers, shutdown_timeout=args.shutdown_timeout))
