"""
Tests for the v2.0 Strategy Engine.

Pins the v2.0 decision contract:
  - score >= run_threshold   -> RUN
  - watch_threshold <= score < run_threshold -> WATCH
  - score < watch_threshold   -> AVOID
  - pillar weakness downgrades decision
  - evaluate_batch sorts by score desc, then by constraint violations asc
  - Action.to_dict() exposes pillar_warnings

Pure Python. No DB, no async.
"""

from app.strategy.engine import (
    STRATEGY_MODEL_VERSION,
    PortfolioState,
    StrategyEngine,
)


class TestStrategyEngine:
    def test_run_when_score_above_threshold(self):
        engine = StrategyEngine()
        portfolio = PortfolioState()
        action = engine.evaluate(netuid=1, score=80.0, portfolio=portfolio)
        assert action.action_type == "run"
        assert action.score == 80.0
        assert action.model_version == STRATEGY_MODEL_VERSION

    def test_watch_when_score_in_band(self):
        engine = StrategyEngine()
        portfolio = PortfolioState()
        action = engine.evaluate(netuid=1, score=60.0, portfolio=portfolio)
        assert action.action_type == "watch"

    def test_avoid_when_score_below_threshold(self):
        engine = StrategyEngine()
        portfolio = PortfolioState()
        action = engine.evaluate(netuid=1, score=20.0, portfolio=portfolio)
        assert action.action_type == "avoid"

    def test_run_downgraded_to_watch_when_max_miners_reached(self):
        engine = StrategyEngine()
        portfolio = PortfolioState(
            current_miners=[{"id": f"m{i}"} for i in range(10)],
        )
        action = engine.evaluate(netuid=1, score=90.0, portfolio=portfolio)
        assert action.action_type == "watch"
        assert any("max_concurrent_miners" in v for v in action.constraints_violated)

    def test_run_downgraded_to_when_spend_cap_reached(self):
        engine = StrategyEngine()
        portfolio = PortfolioState(monthly_spend_inr=500_000.0)
        action = engine.evaluate(
            netuid=1, score=90.0, portfolio=portfolio, estimated_monthly_cost_inr=50_000.0
        )
        assert action.action_type == "watch"
        assert any("max_monthly_spend_inr" in v for v in action.constraints_violated)

    def test_pillar_weakness_downgrades_decision(self):
        engine = StrategyEngine()
        portfolio = PortfolioState()
        action = engine.evaluate(
            netuid=1,
            score=80.0,
            portfolio=portfolio,
            pillar_scores={"utility": 20.0, "technical": 85.0, "economics": 90.0},
        )
        assert action.action_type == "watch"
        assert any("weak pillar" in w.lower() for w in action.pillar_warnings)

    def test_pillar_weakness_downgrades_watch_to_avoid(self):
        engine = StrategyEngine()
        portfolio = PortfolioState()
        action = engine.evaluate(
            netuid=1,
            score=50.0,
            portfolio=portfolio,
            pillar_scores={"utility": 10.0, "technical": 85.0, "economics": 90.0},
        )
        assert action.action_type == "avoid"
        assert any("weak pillar" in w.lower() for w in action.pillar_warnings)

    def test_pillar_weakness_does_not_downgrade_when_all_strong(self):
        engine = StrategyEngine()
        portfolio = PortfolioState()
        action = engine.evaluate(
            netuid=1,
            score=85.0,
            portfolio=portfolio,
            pillar_scores={"utility": 80.0, "technical": 85.0, "economics": 90.0},
        )
        assert action.action_type == "run"
        assert not action.pillar_warnings

    def test_evaluate_batch_sorts_correctly(self):
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

    def test_action_to_dict_has_pillar_warnings(self):
        engine = StrategyEngine()
        portfolio = PortfolioState()
        action = engine.evaluate(
            netuid=1,
            score=80.0,
            portfolio=portfolio,
            pillar_scores={"utility": 20.0, "technical": 85.0, "economics": 90.0},
        )
        d = action.to_dict()
        assert "pillar_warnings" in d
        assert isinstance(d["pillar_warnings"], list)
        assert d["action_type"] == "watch"
        assert d["model_version"] == STRATEGY_MODEL_VERSION
