"""
Scoring Worker — Phase 3 (Subnet Scoring Engine).

Drives `OpportunityService.score_subnet` for every known netuid on each
tick. Per the explainability invariant, every persisted score carries
`model_version` (from `app.intelligence.SCORE_MODEL_VERSION`) and the
per-component explanations are written to `score_components`.
"""
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.workers.base import BaseWorker, RetryConfig, StructuredLogger
from app.services.subnet_service import SubnetService
from app.services.opportunity_service import OpportunityService
from app.intelligence import SCORE_MODEL_VERSION


class ScoringWorker(BaseWorker):
    """
    Worker for scoring and ranking infrastructure opportunities.

    Phase 2 Implementation Plan:
    - Consume scan results from scanner worker
    - Consume market data from market data worker
    - Calculate profitability scores for each opportunity
    - Rank opportunities by risk-adjusted returns
    - Emit scored opportunities for decision engine
    - Track scoring accuracy for model improvement
    """

    def __init__(
        self,
        interval_seconds: float = 300.0,  # 5 minutes, triggered by scan results
        config: Optional[Dict[str, Any]] = None,
        db: Optional[AsyncSession] = None,
    ):
        retry_config = RetryConfig(
            max_attempts=3,
            base_delay=1.0,
            max_delay=20.0,
        )
        super().__init__(
            name="scoring",
            interval_seconds=interval_seconds,
            retry_config=retry_config,
        )
        self.config = config or {}
        self.logger = StructuredLogger("worker.scoring")
        self.db = db
        self._subnets: Optional[SubnetService] = SubnetService(db) if db is not None else None
        self._opportunities: Optional[OpportunityService] = (
            OpportunityService(db) if db is not None else None
        )
        # Legacy 5-key weights — inert scaffolding kept for forward
        # compatibility; the real scoring weights live in
        # `app.intelligence.DEFAULT_WEIGHTS` and are applied by
        # `OpportunityService.score_subnet` -> `compute_opportunity_score`.
        self._scoring_weights: Dict[str, float] = self.config.get(
            "scoring_weights",
            {
                "roi_weight": 0.4,
                "risk_weight": 0.2,
                "liquidity_weight": 0.15,
                "confidence_weight": 0.15,
                "diversification_weight": 0.1,
            }
        )
        self._min_score_threshold: float = self.config.get("min_score_threshold", 0.5)
        self._max_opportunities_per_cycle: int = self.config.get("max_opportunities_per_cycle", 50)

    async def run(self) -> None:
        """
        Main scoring loop.

        Phase 3:
        1. Resolve the list of netuids to score (from SubnetService).
        2. For each netuid, compute the v1.0 score via OpportunityService
           and persist it (OpportunityScore + ScoreComponent rows).
        3. Log a one-line summary with model_version + counts.
        """
        self.logger.info("Starting scoring cycle")

        if self._subnets is None or self._opportunities is None:
            self.logger.warning(
                "Scoring worker invoked without a DB session; nothing to do."
            )
            return

        try:
            netuids = await self._subnets.get_known_netuids()
        except Exception as e:
            self.logger.error(f"Failed to list known netuids: {e}")
            return

        scored = 0
        errors: List[str] = []
        for netuid in netuids:
            try:
                result = await self._opportunities.score_subnet(netuid)
                if result is None:
                    # No metrics row yet for this netuid — skip silently.
                    continue
                await self._opportunities.persist_score(netuid, result)
                scored += 1
            except Exception as e:
                errors.append(f"netuid={netuid}: {e}")

        self.logger.info(
            f"scoring_complete scored={scored} model_version={SCORE_MODEL_VERSION} "
            f"errors={len(errors)}"
        )
        if errors:
            for err in errors:
                self.logger.error(f"score_error {err}")

    async def _fetch_scan_results(self) -> List[int]:
        """Return the list of netuids to score on this tick.

        Phase 3 replaces the queue-based stub with a direct read from
        SubnetService.get_known_netuids (added in Phase 2). The
        ``message_queue``/``cache`` integration lives in a later pass.
        """
        if self._subnets is None:
            return []
        return await self._subnets.get_known_netuids()

    async def _fetch_market_data(self) -> Dict[str, Any]:
        """
        Fetch latest market data for scoring calculations.

        Returns:
            Dict with crypto prices, FX rates, GPU prices
        """
        # Phase 2: Implement cache read or queue consumption
        # from app.services.cache import CacheService
        # cache = CacheService()
        # crypto = await cache.get("market:crypto")
        # fx = await cache.get("market:fx")
        # gpu = await cache.get("market:gpu")
        # return {"crypto": crypto, "fx": fx, "gpu": gpu}
        return {}

    async def _score_opportunities(
        self,
        netuids: List[int],
    ) -> List[Dict[str, Any]]:
        """
        Score every netuid via the v1.0 rule engine and persist the result.

        Returns:
            List of score result dicts (one per netuid with metrics).
        """
        if self._opportunities is None:
            return []
        results: List[Dict[str, Any]] = []
        for netuid in netuids:
            result = await self._opportunities.score_subnet(netuid)
            if result is None:
                continue
            await self._opportunities.persist_score(netuid, result)
            results.append(result)
        return results

    def _calculate_roi_score(
        self,
        opportunity: Dict[str, Any],
        market_data: Dict[str, Any],
    ) -> float:
        """
        Calculate ROI component score (0-1).

        Factors:
        - Projected subnet emissions vs compute costs
        - TAO price trajectory
        - Registration cost amortization
        """
        # Phase 2: Implement financial model
        # estimated_revenue = opportunity.get("estimated_revenue_per_epoch", 0)
        # estimated_cost = opportunity.get("estimated_cost_per_epoch", 1)
        # raw_roi = (estimated_revenue - estimated_cost) / estimated_cost
        # return self._normalize_roi(raw_roi)
        return 0.5

    def _calculate_risk_score(
        self,
        opportunity: Dict[str, Any],
        market_data: Dict[str, Any],
    ) -> float:
        """
        Calculate risk component score (0-1, higher = lower risk).

        Factors:
        - Subnet age and stability
        - Provider SLA and track record
        - GPU price volatility
        - TAO price volatility
        - Registration queue position
        """
        # Phase 2: Implement risk model
        return 0.5

    def _calculate_liquidity_score(self, opportunity: Dict[str, Any]) -> float:
        """
        Calculate liquidity component score (0-1).

        Factors:
        - Spot instance availability
        - Subnet deregistration ease
        - Market depth for TAO
        """
        # Phase 2: Implement liquidity model
        return 0.5

    def _calculate_confidence_score(
        self,
        opportunity: Dict[str, Any],
        market_data: Dict[str, Any],
    ) -> float:
        """
        Calculate confidence component score (0-1).

        Factors:
        - Data freshness
        - Source reliability
        - Model prediction variance
        """
        # Phase 2: Implement confidence model
        return 0.5

    def _calculate_diversification_score(
        self,
        opportunity: Dict[str, Any],
        portfolio: List[Dict[str, Any]],
    ) -> float:
        """
        Calculate diversification benefit score (0-1).

        Factors:
        - GPU type diversification
        - Provider diversification
        - Geographic diversification
        - Subnet category diversification
        """
        # Phase 2: Implement portfolio correlation model
        return 0.5

    def _composite_score(self, scores: Dict[str, float]) -> float:
        """Calculate weighted composite score."""
        return sum(
            scores.get(key.replace("_score", "_weight"), 0) * value
            for key, value in scores.items()
            if key.endswith("_score")
        )

    def _rank_and_filter(
        self,
        scored_opportunities: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """
        Rank opportunities by composite score and filter by threshold.
        """
        # Sort by composite score descending
        ranked = sorted(
            scored_opportunities,
            key=lambda x: x.get("composite_score", 0),
            reverse=True
        )

        # Add rank and filter
        filtered = []
        for i, opp in enumerate(ranked):
            if opp.get("composite_score", 0) >= self._min_score_threshold:
                opp["rank"] = i + 1
                opp["recommendation"] = self._get_recommendation(opp["composite_score"])
                filtered.append(opp)

        return filtered[:self._max_opportunities_per_cycle]

    def _get_recommendation(self, score: float) -> str:
        """Convert score to recommendation."""
        if score >= 0.75:
            return "buy"
        elif score >= 0.5:
            return "hold"
        return "avoid"

    async def _publish_scored_opportunities(self, opportunities: List[Dict[str, Any]]) -> None:
        """
        Publish scored opportunities for decision engine / execution worker.
        """
        # Phase 2: Implement queue publish
        # from app.services.message_queue import MessageQueue
        # queue = MessageQueue()
        # await queue.publish("scored_opportunities", {"opportunities": opportunities})
        pass

    async def _store_scoring_metrics(self, opportunities: List[Dict[str, Any]]) -> None:
        """
        Store scoring metrics for model monitoring and improvement.
        """
        # Phase 2: Implement metrics storage
        # from app.services.metrics import MetricsService
        # metrics = MetricsService()
        # await metrics.record_scoring_batch(opportunities)
        pass


def create_scoring_worker(
    interval_seconds: float = 300.0,
    config: Optional[Dict[str, Any]] = None,
    db: Optional[AsyncSession] = None,
) -> ScoringWorker:
    """Create a configured ScoringWorker instance."""
    return ScoringWorker(interval_seconds=interval_seconds, config=config, db=db)