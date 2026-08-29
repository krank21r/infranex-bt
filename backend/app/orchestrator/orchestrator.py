"""
Miner orchestrator — central lifecycle coordinator.

Wires together the existing services into a coherent flow:
  Strategy -> Approval -> Provision -> Setup -> Deploy -> Monitor -> Optimize/Recover
"""
import logging
from typing import Any, Dict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Miner
from app.strategy.engine import PortfolioState, Action
from app.orchestrator.state_machine import MinerLifecycle, MinerState

logger = logging.getLogger(__name__)

ORCHESTRATOR_MODEL_VERSION = "v1.0"


class MinerOrchestrator:
    """Central coordinator for miner lifecycles.

    Owns the full lifecycle: receives Actions from Strategy, routes through
    Approval, calls DevOps, manages running miners.

    Does NOT write deployment/miner rows directly — delegates to the
    existing services. This class is the state-machine driver.
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._lifecycles: Dict[str, MinerLifecycle] = {}

    def _lifecycle(self, miner_id: str, netuid: int) -> MinerLifecycle:
        if miner_id not in self._lifecycles:
            self._lifecycles[miner_id] = MinerLifecycle(miner_id=miner_id, netuid=netuid)
        return self._lifecycles[miner_id]

    async def process_action(self, action: Action) -> Dict[str, Any]:
        """Process a single Strategy Action.

        Routes the action through the appropriate lifecycle states.
        Returns a result dict describing what was done.
        """
        if action.action_type == "enter":
            return await self._handle_enter(action)
        elif action.action_type == "hold":
            return {"status": "hold", "action": action.to_dict()}
        elif action.action_type == "exit":
            return await self._handle_exit(action)
        else:
            return {"status": "unknown", "action": action.to_dict()}

    async def _handle_enter(self, action: Action) -> Dict[str, Any]:
        """Route an ENTER action through approval -> provisioning -> setup -> deploy."""
        netuid = action.netuid
        lifecycle = self._lifecycle("pending", netuid)

        try:
            lifecycle.transition(MinerState.SCORING, {"score": action.score})
            lifecycle.transition(MinerState.APPROVING, {"action": action.to_dict()})
        except ValueError as exc:
            logger.error("Lifecycle transition failed for ENTER netuid=%s: %s", netuid, exc)
            return {"status": "error", "error": str(exc), "action": action.to_dict()}

        return {
            "status": "enter_queued",
            "netuid": netuid,
            "lifecycle": lifecycle.to_dict(),
            "action": action.to_dict(),
            "model_version": ORCHESTRATOR_MODEL_VERSION,
        }

    async def _handle_exit(self, action: Action) -> Dict[str, Any]:
        """Route an EXIT action — find running miners on the subnet and terminate."""
        netuid = action.netuid
        result = await self.db.execute(
            select(Miner).where(Miner.netuid == netuid).where(Miner.status == "running")
        )
        miners = result.scalars().all()

        terminated = []
        for miner in miners:
            lifecycle = self._lifecycle(miner.id, miner.netuid)
            try:
                lifecycle.transition(MinerState.EXITING, {"reason": action.reason})
                lifecycle.transition(MinerState.TERMINATED, {"miner_id": miner.id})
                terminated.append(miner.id)
            except ValueError as exc:
                logger.error(
                    "Lifecycle transition failed for EXIT miner=%s: %s", miner.id, exc
                )

        return {
            "status": "exit_queued",
            "netuid": netuid,
            "terminated_count": len(terminated),
            "terminated_miner_ids": terminated,
            "action": action.to_dict(),
            "model_version": ORCHESTRATOR_MODEL_VERSION,
        }

    async def tick(self, portfolio: PortfolioState) -> Dict[str, Any]:
        """Run one orchestrator tick.

        In a full implementation this would:
          1. Pull latest scored opportunities from the DB.
          2. Run StrategyEngine.evaluate_batch.
          3. Process each resulting Action.
          4. Advance running miners through monitoring -> optimize/recover.

        For now it returns a summary of current lifecycles.
        """
        summary = {
            "active_lifecycles": len(self._lifecycles),
            "states": {},
            "model_version": ORCHESTRATOR_MODEL_VERSION,
        }
        for lc in self._lifecycles.values():
            summary["states"][lc.state.value] = summary["states"].get(lc.state.value, 0) + 1
        return summary
