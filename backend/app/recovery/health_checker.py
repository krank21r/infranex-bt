"""
Health checker — pure-Python functions that inspect raw miner state.

No DB access, no side effects. The `MonitoringService` (or any caller)
feeds in the raw fields from `Miner` and `MinerHealth` rows; this module
aggregates them into a single `HealthSignal`.

HealthSignal statuses:
  - healthy     : process running, subnet connected, GPU util >= 50%
  - degraded    : process running + connected, but soft issues
                   (low GPU util, high temp, warnings)
  - unhealthy   : process down, subnet disconnected, or critical error
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Optional

HEALTH_CHECK_MODEL_VERSION = "v1.0"

GPU_UTIL_HEALTHY_THRESHOLD = 50.0
GPU_UTIL_DEGRADED_THRESHOLD = 20.0
GPU_TEMP_WARNING_THRESHOLD = 85.0


@dataclass(frozen=True)
class HealthSignal:
    """Aggregated health assessment for one miner."""
    status: str  # "healthy" | "degraded" | "unhealthy"
    process_running: bool
    subnet_connected: bool
    gpu_utilization: Optional[float]
    gpu_temperature: Optional[float]
    gpu_memory_utilization: Optional[float]
    errors: List[str]
    signal_timestamp: str
    model_version: str

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "process_running": self.process_running,
            "subnet_connected": self.subnet_connected,
            "gpu_utilization": self.gpu_utilization,
            "gpu_temperature": self.gpu_temperature,
            "gpu_memory_utilization": self.gpu_memory_utilization,
            "errors": self.errors,
            "signal_timestamp": self.signal_timestamp,
            "model_version": self.model_version,
        }


class HealthChecker:
    """Pure health-check aggregator. Callable from MonitoringService."""

    @staticmethod
    def check_miner_process(
        process_id: Optional[int],
        status: Optional[str],
        miner_process_running: Optional[bool],
    ) -> bool:
        """Return True iff the miner process appears to be running."""
        if miner_process_running is not None:
            return bool(miner_process_running)
        if process_id is not None and process_id > 0:
            return True
        if status and status.lower() in ("running", "started", "active"):
            return True
        return False

    @staticmethod
    def check_subnet_connectivity(subnet_connected: Optional[bool]) -> bool:
        """Return True iff the miner is connected to its subnet."""
        if subnet_connected is None:
            return False
        return bool(subnet_connected)

    @staticmethod
    def measure_gpu_utilization(gpu_utilization: Optional[float]) -> Optional[float]:
        """Return the GPU utilization pct, or None if unknown."""
        if gpu_utilization is None:
            return None
        return max(0.0, min(100.0, float(gpu_utilization)))

    @classmethod
    def aggregate(
        cls,
        *,
        process_running: bool,
        subnet_connected: bool,
        gpu_utilization: Optional[float] = None,
        gpu_temperature: Optional[float] = None,
        gpu_memory_utilization: Optional[float] = None,
        errors: Optional[List[str]] = None,
        signal_timestamp: Optional[str] = None,
    ) -> HealthSignal:
        """Aggregate individual checks into a single HealthSignal."""
        now = signal_timestamp or datetime.now(timezone.utc).isoformat()
        errs = list(errors or [])

        if not process_running:
            return HealthSignal(
                status="unhealthy",
                process_running=False,
                subnet_connected=subnet_connected,
                gpu_utilization=gpu_utilization,
                gpu_temperature=gpu_temperature,
                gpu_memory_utilization=gpu_memory_utilization,
                errors=["miner process not running"] + errs,
                signal_timestamp=now,
                model_version=HEALTH_CHECK_MODEL_VERSION,
            )

        if not subnet_connected:
            return HealthSignal(
                status="unhealthy",
                process_running=True,
                subnet_connected=False,
                gpu_utilization=gpu_utilization,
                gpu_temperature=gpu_temperature,
                gpu_memory_utilization=gpu_memory_utilization,
                errors=["subnet disconnected"] + errs,
                signal_timestamp=now,
                model_version=HEALTH_CHECK_MODEL_VERSION,
            )

        util = cls.measure_gpu_utilization(gpu_utilization)
        if util is not None and util < GPU_UTIL_DEGRADED_THRESHOLD:
            return HealthSignal(
                status="degraded",
                process_running=True,
                subnet_connected=True,
                gpu_utilization=util,
                gpu_temperature=gpu_temperature,
                gpu_memory_utilization=gpu_memory_utilization,
                errors=["low GPU utilization"] + errs,
                signal_timestamp=now,
                model_version=HEALTH_CHECK_MODEL_VERSION,
            )

        if gpu_temperature is not None and gpu_temperature > GPU_TEMP_WARNING_THRESHOLD:
            return HealthSignal(
                status="degraded",
                process_running=True,
                subnet_connected=True,
                gpu_utilization=util,
                gpu_temperature=gpu_temperature,
                gpu_memory_utilization=gpu_memory_utilization,
                errors=["high GPU temperature"] + errs,
                signal_timestamp=now,
                model_version=HEALTH_CHECK_MODEL_VERSION,
            )

        return HealthSignal(
            status="healthy",
            process_running=True,
            subnet_connected=True,
            gpu_utilization=util,
            gpu_temperature=gpu_temperature,
            gpu_memory_utilization=gpu_memory_utilization,
            errors=errs,
            signal_timestamp=now,
            model_version=HEALTH_CHECK_MODEL_VERSION,
        )


def aggregate_health_signal(
    *,
    process_running: bool,
    subnet_connected: bool,
    gpu_utilization: Optional[float] = None,
    gpu_temperature: Optional[float] = None,
    gpu_memory_utilization: Optional[float] = None,
    errors: Optional[List[str]] = None,
    signal_timestamp: Optional[str] = None,
) -> HealthSignal:
    """Module-level convenience wrapper around HealthChecker.aggregate."""
    return HealthChecker.aggregate(
        process_running=process_running,
        subnet_connected=subnet_connected,
        gpu_utilization=gpu_utilization,
        gpu_temperature=gpu_temperature,
        gpu_memory_utilization=gpu_memory_utilization,
        errors=errors,
        signal_timestamp=signal_timestamp,
    )
