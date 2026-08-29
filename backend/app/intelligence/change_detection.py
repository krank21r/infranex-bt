"""
Change detection — pure logic for detecting subnet state shifts.

Compares current subnet state against a baseline snapshot and produces
structured diffs. No DB access, no side effects, deterministic.

Change types detected:
    emission_shift       — emission rate changed beyond threshold
    incentive_shift      — average incentive changed beyond threshold
    stake_shift          — total stake changed beyond threshold
    requirement_change   — miner requirements changed (VRAM, CUDA, etc.)
    market_shift         — alpha price / liquidity changed beyond threshold
    registration_change  — registration cost or openness changed
    concentration_shift  — top-N concentration changed beyond threshold
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


MODEL_VERSION = "v1.0"

DEFAULT_THRESHOLDS = {
    "emission_shift": 0.10,
    "incentive_shift": 0.15,
    "stake_shift": 0.20,
    "market_shift": 0.25,
    "concentration_shift": 0.10,
}


@dataclass(frozen=True)
class SubnetStateDiff:
    """A single detected change in subnet state."""
    change_type: str
    field: str
    old_value: Any
    new_value: Any
    shift_ratio: float
    impact: str  # "none", "low", "medium", "high", "critical"
    detected_at: str


@dataclass(frozen=True)
class ChangeDetectionResult:
    """Result of comparing two subnet states."""
    netuid: int
    changes: List[SubnetStateDiff]
    has_significant_change: bool
    highest_impact: str
    detected_at: str
    model_version: str = MODEL_VERSION


def _impact_from_ratio(ratio: float) -> str:
    if ratio < 0.05:
        return "none"
    if ratio < 0.15:
        return "low"
    if ratio < 0.30:
        return "medium"
    if ratio < 0.50:
        return "high"
    return "critical"


def _ratio(old: Optional[float], new: Optional[float]) -> float:
    if old is None and new is None:
        return 0.0
    if old is None or new is None:
        return 1.0
    if old == 0.0:
        return 1.0 if new != 0.0 else 0.0
    return abs(new - old) / abs(old)


def _compare_metrics(
    old_metrics: Dict[str, Any],
    new_metrics: Dict[str, Any],
    thresholds: Dict[str, float],
    detected_at: str,
) -> List[SubnetStateDiff]:
    changes: List[SubnetStateDiff] = []

    metric_fields = [
        ("emission", "emission_shift"),
        ("average_incentive", "incentive_shift"),
        ("total_stake", "stake_shift"),
        ("top_5_concentration", "concentration_shift"),
        ("top_10_concentration", "concentration_shift"),
        ("neuron_utilization", "incentive_shift"),
        ("trust", "incentive_shift"),
        ("consensus", "incentive_shift"),
        ("miner_turnover", "incentive_shift"),
    ]

    for field, change_type in metric_fields:
        old_val = old_metrics.get(field)
        new_val = new_metrics.get(field)
        if old_val is None and new_val is None:
            continue

        threshold = thresholds.get(change_type, 0.15)
        ratio = _ratio(
            float(old_val) if old_val is not None else None,
            float(new_val) if new_val is not None else None,
        )

        if ratio >= threshold:
            changes.append(SubnetStateDiff(
                change_type=change_type,
                field=field,
                old_value=old_val,
                new_value=new_val,
                shift_ratio=round(ratio, 4),
                impact=_impact_from_ratio(ratio),
                detected_at=detected_at,
            ))

    return changes


def _compare_market(
    old_market: Dict[str, Any],
    new_market: Dict[str, Any],
    threshold: float,
    detected_at: str,
) -> List[SubnetStateDiff]:
    changes: List[SubnetStateDiff] = []

    market_fields = [
        "alpha_price_1d_change",
        "liquidity",
        "volume_market_cap_ratio",
        "tao_price_usd",
        "tao_price_inr",
    ]

    for field in market_fields:
        old_val = old_market.get(field)
        new_val = new_market.get(field)
        if old_val is None and new_val is None:
            continue

        ratio = _ratio(
            float(old_val) if old_val is not None else None,
            float(new_val) if new_val is not None else None,
        )

        if ratio >= threshold:
            changes.append(SubnetStateDiff(
                change_type="market_shift",
                field=field,
                old_value=old_val,
                new_value=new_val,
                shift_ratio=round(ratio, 4),
                impact=_impact_from_ratio(ratio),
                detected_at=detected_at,
            ))

    return changes


def _compare_requirements(
    old_req: Dict[str, Any],
    new_req: Dict[str, Any],
    detected_at: str,
) -> List[SubnetStateDiff]:
    changes: List[SubnetStateDiff] = []

    req_fields = [
        "min_vram_gb",
        "recommended_gpu",
        "cuda_version",
        "pytorch_version",
        "ram_gb",
        "cpu_cores",
        "storage_gb",
        "docker_required",
        "nvidia_runtime_required",
        "startup_command",
        "miner_command",
    ]

    for field in req_fields:
        old_val = old_req.get(field)
        new_val = new_req.get(field)
        if old_val == new_val:
            continue

        if isinstance(old_val, (int, float)) and isinstance(new_val, (int, float)):
            ratio = _ratio(old_val, new_val)
            impact = _impact_from_ratio(ratio)
        else:
            ratio = 1.0 if (old_val is None or new_val is None) else 0.5
            impact = "high" if ratio >= 0.5 else "medium"

        changes.append(SubnetStateDiff(
            change_type="requirement_change",
            field=field,
            old_value=old_val,
            new_value=new_val,
            shift_ratio=round(ratio, 4),
            impact=impact,
            detected_at=detected_at,
        ))

    return changes


def _compare_registration(
    old_metrics: Dict[str, Any],
    new_metrics: Dict[str, Any],
    detected_at: str,
) -> List[SubnetStateDiff]:
    changes: List[SubnetStateDiff] = []

    old_cost = old_metrics.get("registration_cost")
    new_cost = new_metrics.get("registration_cost")
    if old_cost is not None and new_cost is not None and old_cost != new_cost:
        ratio = _ratio(old_cost, new_cost)
        changes.append(SubnetStateDiff(
            change_type="registration_change",
            field="registration_cost",
            old_value=old_cost,
            new_value=new_cost,
            shift_ratio=round(ratio, 4),
            impact=_impact_from_ratio(ratio),
            detected_at=detected_at,
        ))

    old_open = old_metrics.get("registration_open")
    new_open = new_metrics.get("registration_open")
    if old_open is not None and new_open is not None and old_open != new_open:
        changes.append(SubnetStateDiff(
            change_type="registration_change",
            field="registration_open",
            old_value=old_open,
            new_value=new_open,
            shift_ratio=1.0,
            impact="high",
            detected_at=detected_at,
        ))

    return changes


def detect_subnet_changes(
    netuid: int,
    old_state: Dict[str, Any],
    new_state: Dict[str, Any],
    thresholds: Optional[Dict[str, float]] = None,
    detected_at: Optional[str] = None,
) -> ChangeDetectionResult:
    """Compare old and new subnet state, return structured diffs.

    Args:
        netuid: subnet identifier
        old_state: baseline snapshot with keys 'metrics', 'market', 'requirements'
        new_state: current snapshot with same structure
        thresholds: optional override for shift detection thresholds
        detected_at: ISO timestamp (defaults to now)

    Returns:
        ChangeDetectionResult with all detected changes
    """
    thresholds = thresholds or DEFAULT_THRESHOLDS
    detected_at = detected_at or datetime.now(timezone.utc).isoformat()

    old_metrics = old_state.get("metrics") or {}
    new_metrics = new_state.get("metrics") or {}
    old_market = old_state.get("market") or {}
    new_market = new_state.get("market") or {}
    old_req = old_state.get("requirements") or {}
    new_req = new_state.get("requirements") or {}

    changes: List[SubnetStateDiff] = []

    changes.extend(_compare_metrics(
        old_metrics, new_metrics, thresholds, detected_at,
    ))
    changes.extend(_compare_market(
        old_market, new_market,
        thresholds.get("market_shift", 0.25),
        detected_at,
    ))
    changes.extend(_compare_requirements(old_req, new_req, detected_at))
    changes.extend(_compare_registration(old_metrics, new_metrics, detected_at))

    impacts = [c.impact for c in changes]
    impact_order = {"none": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
    highest = max(impacts, key=lambda x: impact_order.get(x, 0)) if impacts else "none"

    return ChangeDetectionResult(
        netuid=netuid,
        changes=changes,
        has_significant_change=any(
            c.impact in ("medium", "high", "critical") for c in changes
        ),
        highest_impact=highest,
        detected_at=detected_at,
    )


def should_trigger_rescore(result: ChangeDetectionResult) -> bool:
    """Whether a change detection result should trigger re-scoring."""
    return result.highest_impact in ("high", "critical")


def should_raise_approval(result: ChangeDetectionResult) -> bool:
    """Whether a change detection result should raise an approval request."""
    return result.highest_impact == "critical"
