"""
Strategy Engine tests.
"""
from app.orchestrator.state_machine import MinerState, can_transition
from app.strategy.engine import (
    STRATEGY_MODEL_VERSION,
    PortfolioState,
    StrategyEngine,
)


class TestStrategyEngine:
    def test_enter_when_score_above_threshold(self):
        engine = StrategyEngine()
        portfolio = PortfolioState()
        action = engine.evaluate(netuid=1, score=80.0, portfolio=portfolio)
        assert action.action_type == "run"
        assert action.score == 80.0
        assert action.model_version == STRATEGY_MODEL_VERSION

    def test_hold_when_score_in_band(self):
        engine = StrategyEngine()
        portfolio = PortfolioState()
        action = engine.evaluate(netuid=1, score=60.0, portfolio=portfolio)
        assert action.action_type == "watch"

    def test_exit_when_score_below_threshold(self):
        engine = StrategyEngine()
        portfolio = PortfolioState()
        action = engine.evaluate(netuid=1, score=20.0, portfolio=portfolio)
        assert action.action_type == "avoid"

    def test_enter_downgraded_to_hold_when_max_miners_reached(self):
        engine = StrategyEngine()
        portfolio = PortfolioState(
            current_miners=[{"id": f"m{i}"} for i in range(10)],
        )
        action = engine.evaluate(netuid=1, score=90.0, portfolio=portfolio)
        assert action.action_type == "watch"
        assert any("max_concurrent_miners" in v for v in action.constraints_violated)

    def test_enter_downgraded_to_hold_when_spend_cap_reached(self):
        engine = StrategyEngine()
        portfolio = PortfolioState(monthly_spend_inr=500_000.0)
        action = engine.evaluate(
            netuid=1, score=90.0, portfolio=portfolio, estimated_monthly_cost_inr=50_000.0
        )
        assert action.action_type == "watch"
        assert any("max_monthly_spend_inr" in v for v in action.constraints_violated)

    def test_evaluate_batch_returns_sorted_actions(self):
        engine = StrategyEngine()
        portfolio = PortfolioState()
        opportunities = [
            {"netuid": 1, "total_score": 50.0, "subnet_name": "A"},
            {"netuid": 2, "total_score": 90.0, "subnet_name": "B"},
            {"netuid": 3, "total_score": 10.0, "subnet_name": "C"},
        ]
        actions = engine.evaluate_batch(opportunities, portfolio)
        assert [a.action_type for a in actions] == ["run", "watch", "avoid"]
        assert [a.netuid for a in actions] == [2, 1, 3]

    def test_action_to_dict_serializable(self):
        engine = StrategyEngine()
        portfolio = PortfolioState()
        action = engine.evaluate(netuid=1, score=80.0, portfolio=portfolio)
        d = action.to_dict()
        assert d["action_type"] == "run"
        assert d["netuid"] == 1
        assert "model_version" in d


class TestStateMachine:
    def test_can_transition_valid(self):
        assert can_transition(MinerState.IDLE, MinerState.SCORING)
        assert can_transition(MinerState.RUNNING, MinerState.MONITORING)
        assert can_transition(MinerState.MONITORING, MinerState.RECOVERING)

    def test_cannot_transition_invalid(self):
        assert not can_transition(MinerState.IDLE, MinerState.RUNNING)
        assert not can_transition(MinerState.TERMINATED, MinerState.RUNNING)
