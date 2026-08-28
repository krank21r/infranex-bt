"""
GPU matching engine (Phase 6).

Pure-Python, deterministic ranker that takes a subnet's requirements
(SubnetRequirement dict) and a list of available GPU offers (GPUOffer
dicts), and returns them ordered by best fit for the workload.

Scoring (per offer, 0.0 - 1.5):
  match_bonus   = 1.0 if offer.gpu_model_name == requirements.recommended_gpu else 0.0
  region_bonus  = 0.5 if preferred_region and offer.region == preferred_region else 0.0
  total_score   = match_bonus + region_bonus

Sort: total_score DESC, then hourly_price ASC. Stable so identical scores
preserve insertion order (which itself comes from the SQL filter — usually
newest / cheapest first).

This is a v1.0 deterministic rule-based ranker. No ML. Outputs are
explainable: every rank is the sum of two named bonuses plus a deterministic
price tie-break.
"""
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple


# Default model version for the ranker. Bump on logic changes.
MATCH_MODEL_VERSION = "v1.0"


@dataclass(frozen=True)
class RankedOffer:
    """One offer with its rank, score, and explainable breakdown."""
    offer: Dict[str, Any]
    total_score: float
    match_bonus: float
    region_bonus: float
    price: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "offer": self.offer,
            "total_score": self.total_score,
            "match_bonus": self.match_bonus,
            "region_bonus": self.region_bonus,
            "price": self.price,
            "model_version": MATCH_MODEL_VERSION,
        }


def _to_float(value) -> float:
    """Safe float coercion; None / non-numeric -> 0.0."""
    try:
        return float(value) if value is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def _eligible_vram(requirements: Dict[str, Any], offer: Dict[str, Any]) -> bool:
    """True iff offer.vram_gb >= requirements.min_vram_gb (or no bar set)."""
    min_vram = _to_float(requirements.get("min_vram_gb"))
    offer_vram = _to_float(offer.get("vram_gb"))
    if min_vram <= 0:
        return True  # No bar set: everything is eligible.
    return offer_vram >= min_vram


def _score_offer(
    requirements: Dict[str, Any],
    offer: Dict[str, Any],
    preferred_region: Optional[str],
) -> Tuple[float, float, float]:
    """Return (match_bonus, region_bonus, total_score) for one offer."""
    rec_gpu = (requirements.get("recommended_gpu") or "").strip()
    offer_gpu = (offer.get("gpu_model_name") or "").strip()
    match_bonus = 1.0 if (rec_gpu and rec_gpu == offer_gpu) else 0.0

    if preferred_region and (offer.get("region") or "") == preferred_region:
        region_bonus = 0.5
    else:
        region_bonus = 0.0

    return match_bonus, region_bonus, match_bonus + region_bonus


def rank_offers_for_requirements(
    requirements: Dict[str, Any],
    offers: List[Dict[str, Any]],
    preferred_region: Optional[str] = None,
) -> List[RankedOffer]:
    """Rank GPU offers for a subnet's requirements.

    Args:
        requirements: dict shape from `_requirements_to_dict` — must include
            at least `min_vram_gb` and (optionally) `recommended_gpu`.
        offers: list of dicts, each with at least `vram_gb`, `hourly_price`,
            and (optionally) `gpu_model_name`, `region`.
        preferred_region: if set, offers in this region get a +0.5 bonus.

    Returns:
        List of `RankedOffer`, sorted best-first (highest total_score, then
        lowest hourly_price as a deterministic tie-break).
    """
    eligible = [o for o in offers if _eligible_vram(requirements, o)]

    ranked: List[RankedOffer] = []
    for offer in eligible:
        match_bonus, region_bonus, total = _score_offer(
            requirements, offer, preferred_region
        )
        ranked.append(
            RankedOffer(
                offer=offer,
                total_score=total,
                match_bonus=match_bonus,
                region_bonus=region_bonus,
                price=_to_float(offer.get("hourly_price")),
            )
        )

    # Stable sort: total_score DESC, then price ASC. Python's sort is stable,
    # so within a (score, price) bucket the input order is preserved.
    ranked.sort(key=lambda r: (-r.total_score, r.price))
    return ranked
