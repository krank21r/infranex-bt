"""
Strategy engine — converts OpportunityScore into RUN / WATCH / AVOID actions.

Pure decision logic. No DB writes. The caller persists the resulting
Action through the approval / deployment services.
"""
from dataclasses import dataclass, field
from typing import Any

STRATEGY_MODEL_VERSION = "v2.0"


@dataclass(frozen=True)
class PortfolioConstraints:
    """Operational limits the strategy must respect."""

    max_concurrent_miners: int = 10
    max_monthly_spend_inr: float = 500_000.0
    max_spend_per_miner_inr: float = 50_000.0
    min_days_between_entries: int = 7
    allowed_subnet_categories: list[str] | None = None


@dataclass(frozen=True)
class PortfolioState:
    """Snapshot of current holdings and exposure."""

    current_miners: list[dict[str, Any]] = field(default_factory=list)
    pending_deployments: list[dict[str, Any]] = field(default_factory=list)
    monthly_spend_inr: float = 0.0
    last_entry_timestamp: str | None = None


@dataclass(frozen=True)
class Action:
    """One actionable decision emitted by the Strategy Engine."""

    action_type: str  # "run" | "watch" | "avoid"
    netuid: int
    score: float
    reason: str
    confidence: float | None = None
    estimated_monthly_profit_inr: float | None = None
    estimated_monthly_cost_inr: float | None = None
    constraints_violated: list[str] = field(default_factory=list)
    pillar_warnings: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    model_version: str = STRATEGY_MODEL_VERSION

    def to_dict(self) -> dict[str, Any]:
        return {
            "action_type": self.action_type,
            "netuid": self.netuid,
            "score": self.score,
            "reason": self.reason,
            "confidence": self.confidence,
            "estimated_monthly_profit_inr": self.estimated_monthly_profit_inr,
            "estimated_monthly_cost_inr": self.estimated_monthly_cost_inr,
            "constraints_violated": self.constraints_violated,
            "pillar_warnings": self.pillar_warnings,
            "metadata": self.metadata,
            "model_version": self.model_version,
        }


class StrategyEngine:
    """Converts OpportunityScore values into actionable RUN / WATCH / AVOID decisions.

    Decision bands (configurable via thresholds):
      score >= run_threshold   -> RUN
      watch_threshold <= score < run_threshold -> WATCH
      score < watch_threshold   -> AVOID

    Portfolio constraints are evaluated before emitting RUN.
    """

    def __init__(
        self,
        constraints: PortfolioConstraints | None = None,
        *,
        run_threshold: float = 75.0,
        watch_threshold: float = 40.0,
        avoid_threshold: float = 40.0,
    ) -> None:
        self.constraints = constraints or PortfolioConstraints()
        self.run_threshold = run_threshold
        self.watch_threshold = watch_threshold
        self.avoid_threshold = avoid_threshold

    def evaluate(
        self,
        netuid: int,
        score: float,
        portfolio: PortfolioState,
        *,
        confidence: float | None = None,
        estimated_monthly_profit_inr: float | None = None,
        estimated_monthly_cost_inr: float | None = None,
        metadata: dict[str, Any] | None = None,
        pillar_scores: dict[str, float] | None = None,
    ) -> Action:
        """Evaluate a single subnet score and return an Action."""

        if score >= self.run_threshold:
            action_type = "run"
            reason = f"Score {score:.1f} exceeds RUN threshold {self.run_threshold}"
        elif score >= self.watch_threshold:
            action_type = "watch"
            reason = f"Score {score:.1f} in WATCH band [{self.watch_threshold}, {self.run_threshold})"
        else:
            action_type = "avoid"
            reason = f"Score {score:.1f} below AVOID threshold {self.avoid_threshold}"

        constraints_violated: list[str] = []
        pillar_warnings: list[str] = []

        if action_type == "run":
            constraints_violated = self._check_constraints(portfolio, estimated_monthly_cost_inr or 0.0)
            if constraints_violated:
                action_type = "watch"
                reason = (
                    f"RUN blocked by constraints: {', '.join(constraints_violated)}. "
                    f"Downgraded to WATCH."
                )

        if pillar_scores:
            weak_pillars = [
                f"{pillar}:{value:.1f}"
                for pillar, value in pillar_scores.items()
                if value <= 20
            ]
            if weak_pillars:
                pillar_warnings.append(f"Weak pillar(s): {', '.join(weak_pillars)}")
                if action_type == "run":
                    action_type = "watch"
                    reason = f"Downgraded to WATCH due to pillar weakness: {', '.join(weak_pillars)}"
                elif action_type == "watch":
                    action_type = "avoid"
                    reason = f"Downgraded to AVOID due to pillar weakness: {', '.join(weak_pillars)}"

        return Action(
            action_type=action_type,
            netuid=netuid,
            score=score,
            reason=reason,
            confidence=confidence,
            estimated_monthly_profit_inr=estimated_monthly_profit_inr,
            estimated_monthly_cost_inr=estimated_monthly_cost_inr,
            constraints_violated=constraints_violated,
            pillar_warnings=pillar_warnings,
            metadata=metadata or {},
            model_version=STRATEGY_MODEL_VERSION,
        )

    def evaluate_batch(
        self,
        opportunities: list[dict[str, Any]],
        portfolio: PortfolioState,
    ) -> list[Action]:
        """Evaluate a batch of scored subnets and return prioritized actions."""
        actions: list[Action] = []
        for opp in opportunities:
            action = self.evaluate(
                netuid=int(opp.get("netuid", 0)),
                score=float(opp.get("total_score", 0.0)),
                portfolio=portfolio,
                confidence=opp.get("confidence"),
                estimated_monthly_profit_inr=opp.get("estimated_monthly_profit_inr"),
                estimated_monthly_cost_inr=opp.get("estimated_monthly_cost_inr"),
                metadata={
                    "subnet_name": opp.get("subnet_name"),
                    "risk_level": opp.get("risk_level"),
                    "recommended_gpu_name": opp.get("recommended_gpu_name"),
                    "pillar_scores": opp.get("pillar_scores"),
                },
                pillar_scores=opp.get("pillar_scores"),
            )
            actions.append(action)

        priority = {"run": 0, "watch": 1, "avoid": 2}
        actions.sort(key=lambda a: (priority.get(a.action_type, 3), -a.score, len(a.constraints_violated)))
        return actions

    def _check_constraints(
        self,
        portfolio: PortfolioState,
        estimated_monthly_cost_inr: float,
    ) -> list[str]:
        """Return list of constraint names that would be violated by a RUN."""
        violations: list[str] = []

        active_count = len(portfolio.current_miners) + len(portfolio.pending_deployments)
        if active_count >= self.constraints.max_concurrent_miners:
            violations.append(
                f"max_concurrent_miners ({active_count}/{self.constraints.max_concurrent_miners})"
            )

        new_spend = portfolio.monthly_spend_inr + estimated_monthly_cost_inr
        if new_spend > self.constraints.max_monthly_spend_inr:
            violations.append(
                f"max_monthly_spend_inr ({new_spend:.0f}/{self.constraints.max_monthly_spend_inr:.0f})"
            )

        if estimated_monthly_cost_inr > self.constraints.max_spend_per_miner_inr:
            violations.append(
                f"max_spend_per_miner_inr ({estimated_monthly_cost_inr:.0f}/{self.constraints.max_spend_per_miner_inr:.0f})"
            )

        return violations
