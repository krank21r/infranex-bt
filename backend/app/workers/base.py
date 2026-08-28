"""
Base Worker Foundation

Provides a robust base class for all background workers with:
- Exponential backoff retry decorator
- Structured logging with correlation IDs
- Metrics emission for monitoring
- Graceful shutdown handling
"""

import asyncio
import logging
import signal
import time
import uuid
from abc import ABC, abstractmethod
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from functools import wraps
from typing import Any, Callable, Dict, Optional, TypeVar

from app.core.config import settings

# Type variable for generic retry decorator
T = TypeVar("T")
F = TypeVar("F", bound=Callable[..., Any])


@dataclass
class WorkerMetrics:
    """Metrics container for worker execution tracking."""
    worker_name: str
    runs_total: int = 0
    runs_success: int = 0
    runs_failed: int = 0
    total_duration_ms: float = 0.0
    last_run_at: Optional[float] = None
    last_error: Optional[str] = None
    retry_counts: Dict[str, int] = field(default_factory=dict)

    def record_success(self, duration_ms: float) -> None:
        self.runs_total += 1
        self.runs_success += 1
        self.total_duration_ms += duration_ms
        self.last_run_at = time.time()

    def record_failure(self, duration_ms: float, error: str) -> None:
        self.runs_total += 1
        self.runs_failed += 1
        self.total_duration_ms += duration_ms
        self.last_run_at = time.time()
        self.last_error = error


@dataclass
class RetryConfig:
    """Configuration for retry behavior."""
    max_attempts: int = 3
    base_delay: float = 1.0
    max_delay: float = 60.0
    exponential_base: float = 2.0
    jitter: bool = True
    retryable_exceptions: tuple = (Exception,)


class StructuredLogger:
    """Structured logger with correlation ID support."""

    def __init__(self, name: str):
        self.logger = logging.getLogger(name)
        self._correlation_id: Optional[str] = None

    @property
    def correlation_id(self) -> str:
        if self._correlation_id is None:
            self._correlation_id = str(uuid.uuid4())[:8]
        return self._correlation_id

    @correlation_id.setter
    def correlation_id(self, value: str) -> None:
        self._correlation_id = value

    def _format(self, message: str, **kwargs: Any) -> str:
        parts = [f"[{self.correlation_id}] {message}"]
        if kwargs:
            parts.append(" | ".join(f"{k}={v}" for k, v in kwargs.items()))
        return " | ".join(parts)

    def debug(self, message: str, **kwargs: Any) -> None:
        self.logger.debug(self._format(message, **kwargs))

    def info(self, message: str, **kwargs: Any) -> None:
        self.logger.info(self._format(message, **kwargs))

    def warning(self, message: str, **kwargs: Any) -> None:
        self.logger.warning(self._format(message, **kwargs))

    def error(self, message: str, **kwargs: Any) -> None:
        self.logger.error(self._format(message, **kwargs))

    def exception(self, message: str, **kwargs: Any) -> None:
        self.logger.exception(self._format(message, **kwargs))


def retry_with_backoff(config: Optional[RetryConfig] = None) -> Callable[[F], F]:
    """
    Decorator for exponential backoff retry with jitter.

    Usage:
        @retry_with_backoff(RetryConfig(max_attempts=3, base_delay=1.0))
        async def unreliable_operation():
            ...
    """
    if config is None:
        config = RetryConfig()

    def decorator(func: F) -> F:
        @wraps(func)
        async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
            last_exception = None
            for attempt in range(1, config.max_attempts + 1):
                try:
                    return await func(*args, **kwargs)
                except config.retryable_exceptions as e:
                    last_exception = e
                    if attempt == config.max_attempts:
                        break

                    delay = min(
                        config.base_delay * (config.exponential_base ** (attempt - 1)),
                        config.max_delay
                    )
                    if config.jitter:
                        import random
                        delay *= (0.5 + random.random())

                    logger = StructuredLogger(func.__module__)
                    logger.warning(
                        f"Retry {attempt}/{config.max_attempts} for {func.__name__}",
                        error=str(e),
                        delay_seconds=round(delay, 2)
                    )
                    await asyncio.sleep(delay)

            raise last_exception

        @wraps(func)
        def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
            last_exception = None
            for attempt in range(1, config.max_attempts + 1):
                try:
                    return func(*args, **kwargs)
                except config.retryable_exceptions as e:
                    last_exception = e
                    if attempt == config.max_attempts:
                        break

                    delay = min(
                        config.base_delay * (config.exponential_base ** (attempt - 1)),
                        config.max_delay
                    )
                    if config.jitter:
                        import random
                        delay *= (0.5 + random.random())

                    logger = StructuredLogger(func.__module__)
                    logger.warning(
                        f"Retry {attempt}/{config.max_attempts} for {func.__name__}",
                        error=str(e),
                        delay_seconds=round(delay, 2)
                    )
                    time.sleep(delay)

            raise last_exception

        if asyncio.iscoroutinefunction(func):
            return async_wrapper  # type: ignore
        return sync_wrapper  # type: ignore

    return decorator


class BaseWorker(ABC):
    """
    Abstract base class for all background workers.

    Provides:
    - Structured logging with correlation IDs
    - Metrics collection
    - Graceful shutdown handling
    - Retry decorator
    - Health check endpoint support
    """

    def __init__(
        self,
        name: str,
        interval_seconds: float = 60.0,
        retry_config: Optional[RetryConfig] = None,
    ):
        self.name = name
        self.interval_seconds = interval_seconds
        self.retry_config = retry_config or RetryConfig()
        self.logger = StructuredLogger(f"worker.{name}")
        self.metrics = WorkerMetrics(worker_name=name)
        self._running = False
        self._shutdown_event = asyncio.Event()
        self._task: Optional[asyncio.Task] = None

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def is_healthy(self) -> bool:
        """Health check - override in subclasses for custom logic."""
        return self._running and not self._shutdown_event.is_set()

    async def start(self) -> None:
        """Start the worker loop."""
        if self._running:
            self.logger.warning("Worker already running")
            return

        self._running = True
        self._shutdown_event.clear()
        self.logger.info(f"Starting worker: {self.name}", interval=self.interval_seconds)
        self._task = asyncio.create_task(self._run_loop())

    async def stop(self, timeout: float = 30.0) -> None:
        """Gracefully stop the worker."""
        if not self._running:
            return

        self.logger.info(f"Stopping worker: {self.name}")
        self._running = False
        self._shutdown_event.set()

        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=timeout)
            except asyncio.TimeoutError:
                self.logger.error(f"Worker {self.name} did not stop gracefully within {timeout}s")
                self._task.cancel()
                try:
                    await self._task
                except asyncio.CancelledError:
                    pass

        self.logger.info(f"Worker stopped: {self.name}")

    async def _run_loop(self) -> None:
        """Main worker loop with interval timing."""
        while self._running and not self._shutdown_event.is_set():
            start_time = time.time()
            try:
                await self.run()
                duration_ms = (time.time() - start_time) * 1000
                self.metrics.record_success(duration_ms)
                self.logger.debug(
                    "Worker run completed",
                    duration_ms=round(duration_ms, 2)
                )
            except Exception as e:
                duration_ms = (time.time() - start_time) * 1000
                self.metrics.record_failure(duration_ms, str(e))
                self.logger.error(
                    "Worker run failed",
                    error=str(e),
                    duration_ms=round(duration_ms, 2)
                )

            # Wait for next interval or shutdown
            try:
                await asyncio.wait_for(
                    self._shutdown_event.wait(),
                    timeout=self.interval_seconds
                )
            except asyncio.TimeoutError:
                # Normal interval timeout, continue loop
                pass

    @abstractmethod
    async def run(self) -> None:
        """
        Main worker execution logic.

        Override this method in subclasses to implement the actual work.
        Should be idempotent and handle its own errors appropriately.
        """
        pass

    def get_metrics(self) -> Dict[str, Any]:
        """Get current worker metrics as dictionary."""
        return {
            "worker_name": self.metrics.worker_name,
            "is_running": self.is_running,
            "is_healthy": self.is_healthy,
            "runs_total": self.metrics.runs_total,
            "runs_success": self.metrics.runs_success,
            "runs_failed": self.metrics.runs_failed,
            "success_rate": (
                self.metrics.runs_success / self.metrics.runs_total
                if self.metrics.runs_total > 0 else 0
            ),
            "avg_duration_ms": (
                self.metrics.total_duration_ms / self.metrics.runs_total
                if self.metrics.runs_total > 0 else 0
            ),
            "last_run_at": self.metrics.last_run_at,
            "last_error": self.metrics.last_error,
        }

    @asynccontextmanager
    async def lifespan(self):
        """Async context manager for worker lifecycle."""
        await self.start()
        try:
            yield self
        finally:
            await self.stop()


def create_worker_logger(name: str) -> StructuredLogger:
    """Factory function to create a structured logger for a worker."""
    return StructuredLogger(f"worker.{name}")