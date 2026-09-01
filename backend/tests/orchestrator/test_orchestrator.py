"""
Miner Orchestrator tests.
"""
from unittest.mock import AsyncMock

import pytest

from app.orchestrator.orchestrator import MinerOrchestrator
from app.orchestrator.state_machine import MinerLifecycle, MinerState
from app.strategy.engine import Action, PortfolioState


class TestMinerLifecycle:
    def test_initial_state_is_idle(self):
        lc = MinerLifecycle(miner_id="m1", netuid=1)
        assert lc.state == MinerState.IDLE

    def test_valid_transition_succeeds(self):
        lc = MinerLifecycle(miner_id="m1", netuid=1)
        lc.transition(MinerState.SCORING)
        assert lc.state == MinerState.SCORING

    def test_invalid_transition_raises(self):
        lc = MinerLifecycle(miner_id="m1", netuid=1)
        with pytest.raises(ValueError):
            lc.transition(MinerState.RUNNING)

    def test_history_records_transitions(self):
        lc = MinerLifecycle(miner_id="m1", netuid=1)
        lc.transition(MinerState.SCORING)
        lc.transition(MinerState.APPROVING)
        assert len(lc.history) == 2
        assert lc.history[0]["from"] == "idle"
        assert lc.history[0]["to"] == "scoring"

    def test_to_dict_serializable(self):
        lc = MinerLifecycle(miner_id="m1", netuid=1)
        lc.transition(MinerState.SCORING)
        d = lc.to_dict()
        assert d["state"] == "scoring"
        assert d["miner_id"] == "m1"
        assert d["netuid"] == 1


class TestMinerOrchestrator:
    @pytest.fixture
    def orchestrator(self):
        db = AsyncMock()
        return MinerOrchestrator(db=db)

    @pytest.mark.asyncio
    async def test_process_enter_queues_approval(self, orchestrator: MinerOrchestrator):
        action = Action(action_type="enter", netuid=1, score=85.0, reason="high score")
        result = await orchestrator.process_action(action)
        assert result["status"] == "enter_queued"
        assert result["netuid"] == 1

    @pytest.mark.asyncio
    async def test_process_hold_returns_directly(self, orchestrator: MinerOrchestrator):
        action = Action(action_type="hold", netuid=1, score=50.0, reason="mid score")
        result = await orchestrator.process_action(action)
        assert result["status"] == "hold"

    @pytest.mark.asyncio
    async def test_tick_returns_summary(self, orchestrator: MinerOrchestrator):
        summary = await orchestrator.tick(PortfolioState())
        assert "active_lifecycles" in summary
        assert "states" in summary
        assert summary["model_version"] == "v1.0"
