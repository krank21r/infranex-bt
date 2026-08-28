"""
Tests for the GPU matching ranker (Phase 6).

Pins the contract:
  - exact recommended_gpu match scores 1.5 (match + region).
  - no recommended_gpu in requirements -> region only (max 0.5).
  - VRAM prefilter excludes underspec'd offers.
  - price ASC tie-breaks identical scores.
  - preferred_region=None / empty does not apply region bonus.
  - ranking is stable across rerun.
  - service-level match_offers paginates and returns (page, total).
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.intelligence.gpu_matching import (
    rank_offers_for_requirements,
    MATCH_MODEL_VERSION,
)
from app.services.gpu_matching_service import GPUMatchingService


# ---------- helpers ----------


def _offer(
    name: str = "A100",
    vram_gb: float = 80.0,
    region: str = "US",
    hourly_price: float = 1.5,
    offer_id: str = "of-1",
    provider_id: str = "prov-1",
    **overrides,
) -> dict:
    d = {
        "id": offer_id,
        "provider_id": provider_id,
        "gpu_model_id": f"gpu-{name}",
        "gpu_model_name": name,
        "region": region,
        "hourly_price": hourly_price,
        "monthly_price": hourly_price * 730,
        "currency": "USD",
        "availability": "available",
        "vram_gb": vram_gb,
        "ram_gb": 256.0,
        "storage_gb": 1000.0,
        "is_spot": False,
        "instance_type": f"{name}-instance",
    }
    d.update(overrides)
    return d


def _requirements(
    min_vram_gb: float = 24.0,
    recommended_gpu: str = "A100",
) -> dict:
    return {
        "min_vram_gb": min_vram_gb,
        "recommended_gpu": recommended_gpu,
        "python_version": "3.10",
    }


# ---------- pure-function tests (5) ----------


def test_exact_recommended_gpu_match_in_preferred_region_scores_top():
    """Match + region (1.0 + 0.5 = 1.5) ranks above match-only (1.0) and region-only (0.5)."""
    req = _requirements(recommended_gpu="A100")
    offers = [
        _offer(name="A100", region="EU", hourly_price=1.0, offer_id="a"),  # match only
        _offer(name="A100", region="US", hourly_price=1.2, offer_id="b"),  # match + region
        _offer(name="H100", region="US", hourly_price=0.8, offer_id="c"),  # region only
    ]
    ranked = rank_offers_for_requirements(req, offers, preferred_region="US")
    assert [r.offer["id"] for r in ranked] == ["b", "a", "c"]
    assert ranked[0].total_score == 1.5
    assert ranked[0].match_bonus == 1.0
    assert ranked[0].region_bonus == 0.5
    assert ranked[1].total_score == 1.0
    assert ranked[2].total_score == 0.5


def test_no_recommended_gpu_in_requirements_only_region_bonus_applies():
    """When requirements don't recommend a specific GPU, only region bonus scores."""
    req = {"min_vram_gb": 24.0, "recommended_gpu": ""}  # empty -> no match
    offers = [
        _offer(name="A100", region="US", hourly_price=2.0, offer_id="a"),
        _offer(name="H100", region="US", hourly_price=1.0, offer_id="b"),
        _offer(name="A100", region="EU", hourly_price=0.5, offer_id="c"),
    ]
    ranked = rank_offers_for_requirements(req, offers, preferred_region="US")
    # Both US offers score 0.5 (region only). Cheaper (b=$1.0) beats
    # costlier (a=$2.0) by the price tie-break. EU offer (c) scores 0.0 -> last.
    assert [r.offer["id"] for r in ranked] == ["b", "a", "c"]
    assert all(r.match_bonus == 0.0 for r in ranked)
    assert ranked[0].region_bonus == 0.5


def test_vram_prefilter_excludes_underspecd_offers():
    """Offers below min_vram_gb are excluded entirely."""
    req = _requirements(min_vram_gb=40.0, recommended_gpu="")
    offers = [
        _offer(name="A100", vram_gb=24.0, hourly_price=1.0, offer_id="low"),  # excluded
        _offer(name="A100", vram_gb=40.0, hourly_price=2.0, offer_id="ok"),
        _offer(name="A100", vram_gb=80.0, hourly_price=3.0, offer_id="high"),
    ]
    ranked = rank_offers_for_requirements(req, offers)
    assert [r.offer["id"] for r in ranked] == ["ok", "high"]
    assert all(r.offer["vram_gb"] >= 40.0 for r in ranked)


def test_price_asc_tiebreaks_identical_scores():
    """When two offers have the same total_score, cheaper wins."""
    req = _requirements(recommended_gpu="A100")
    offers = [
        _offer(name="A100", region="US", hourly_price=2.0, offer_id="expensive"),
        _offer(name="A100", region="US", hourly_price=1.0, offer_id="cheap"),
        _offer(name="A100", region="US", hourly_price=1.5, offer_id="middle"),
    ]
    ranked = rank_offers_for_requirements(req, offers, preferred_region="US")
    # All three score 1.5 (match + region). Sort by price ASC.
    assert [r.offer["id"] for r in ranked] == ["cheap", "middle", "expensive"]
    assert all(r.total_score == 1.5 for r in ranked)


def test_preferred_region_none_or_empty_does_not_apply_region_bonus():
    """With preferred_region=None or '', region_bonus is always 0.0."""
    req = _requirements(recommended_gpu="A100")
    offers = [
        _offer(name="A100", region="US", hourly_price=1.0, offer_id="us"),
        _offer(name="A100", region="EU", hourly_price=1.0, offer_id="eu"),
    ]
    # preferred_region=None
    ranked_none = rank_offers_for_requirements(req, offers, preferred_region=None)
    assert all(r.region_bonus == 0.0 for r in ranked_none)
    # Both have match_bonus=1.0; price is identical; insertion order preserved.
    assert [r.offer["id"] for r in ranked_none] == ["us", "eu"]

    # preferred_region=""
    ranked_empty = rank_offers_for_requirements(req, offers, preferred_region="")
    assert all(r.region_bonus == 0.0 for r in ranked_empty)


# ---------- stability + model version pin ----------


def test_ranking_is_stable_and_deterministic_across_reruns():
    """Same input -> same output, deterministically. Re-run twice."""
    req = _requirements(recommended_gpu="A100")
    offers = [
        _offer(name="A100", region="US", hourly_price=1.0, offer_id="x"),
        _offer(name="A100", region="EU", hourly_price=0.5, offer_id="y"),
        _offer(name="H100", region="US", hourly_price=2.0, offer_id="z"),
    ]
    first = rank_offers_for_requirements(req, offers, preferred_region="US")
    second = rank_offers_for_requirements(req, offers, preferred_region="US")
    assert [r.offer["id"] for r in first] == [r.offer["id"] for r in second]
    # x scores 1.5, y scores 1.0, z scores 0.5.
    assert [r.offer["id"] for r in first] == ["x", "y", "z"]


def test_model_version_is_v1():
    """Version pin — must be bumped on any ranker logic change."""
    assert MATCH_MODEL_VERSION == "v1.0"


# ---------- service-level (async, paginated) ----------


def _row(offer_dict: dict) -> tuple:
    """Build a (GPUOffer, gpu_name) tuple mimicking the SQLAlchemy row shape."""
    offer = MagicMock()
    offer.id = offer_dict["id"]
    offer.provider_id = offer_dict["provider_id"]
    offer.gpu_model_id = offer_dict["gpu_model_id"]
    offer.gpu_model_name = None  # not used; we use the joined column
    offer.region = offer_dict["region"]
    offer.hourly_price = offer_dict["hourly_price"]
    offer.monthly_price = offer_dict["monthly_price"]
    offer.currency = offer_dict["currency"]
    offer.availability = offer_dict["availability"]
    offer.vram_gb = offer_dict["vram_gb"]
    offer.ram_gb = offer_dict["ram_gb"]
    offer.storage_gb = offer_dict["storage_gb"]
    offer.is_spot = offer_dict["is_spot"]
    offer.instance_type = offer_dict["instance_type"]
    return (offer, offer_dict["gpu_model_name"])


@pytest.mark.asyncio
async def test_match_offers_paginates_and_returns_total():
    """Service: 5 eligible offers, page_size=2 -> (2 items, total=5)."""
    offers = [
        _offer(name="A100", region="US", hourly_price=1.0, offer_id=f"o-{i}")
        for i in range(5)
    ]
    rows = [_row(o) for o in offers]

    svc = GPUMatchingService(db=AsyncMock())

    async def fake_execute(stmt):
        r = MagicMock()
        r.all.return_value = rows
        return r

    svc.db.execute = AsyncMock(side_effect=fake_execute)

    req = _requirements(min_vram_gb=24.0, recommended_gpu="A100")
    page, total = await svc.match_offers(req, preferred_region="US", page=1, page_size=2)
    assert total == 5
    assert len(page) == 2
    # All match + region (1.5) since we built A100/US only; price-asc.
    assert all(r.total_score == 1.5 for r in page)
    assert page[0].price <= page[1].price
