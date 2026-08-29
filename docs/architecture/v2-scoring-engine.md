# v2.0 Scoring Engine — 3-Pillar Model

> Last updated: 2026-08-29

---

## Overview

The v2.0 scoring model reorganizes the subnet opportunity assessment into three intuitive pillars:

```
  ┌──────────┐   ┌──────────┐   ┌──────────┐
  │ UTILITY  │   │TECHNICAL │   │ECONOMICS │
  │  (30%)   │   │  (35%)   │   │  (35%)   │
  └────┬─────┘   └────┬─────┘   └────┬─────┘
       │              │              │
       └──────────────┼──────────────┘
                      ▼
          OPPORTUNITY SCORE (0-100)
                      ▼
          RUN / WATCH / AVOID
```

Each pillar produces a sub-score (0-100). The weighted combination produces the Opportunity Score.

---

## Pillar 1: Utility (30%)

**Question:** What does the subnet actually do? Is it a useful service?

### Inputs
| Source | Data |
|--------|------|
| `subnets` table | name, description, category, metadata |
| GitHub README | purpose, problem statement, use cases |
| Subnet registration | tokenomics, governance model |

### Scoring Logic

```python
def score_utility(subnet: Subnet, readme: str, metadata: dict) -> ScoreComponent:
    """
    Qualitative assessment of subnet purpose and value.
    
    Scoring factors:
    - Does it solve a real problem? (+30)
    - Is it a unique service or a copycat? (+20)
    - Is the description clear and detailed? (+15)
    - Does it have active development? (+15)
    - Is the tokenomics sound? (+10)
    - Is the governance decentralized? (+10)
    """
```

### Score Bands
| Score | Meaning |
|-------|---------|
| 80-100 | Clear, useful, unique service |
| 60-79 | Useful but competitive space |
| 40-59 | Generic or unclear purpose |
| 20-39 | Copycat or low-value |
| 0-19 | No clear utility |

---

## Pillar 2: Technical (35%)

**Question:** Can we actually run this subnet? What hardware do we need?

### Inputs
| Source | Data |
|--------|------|
| `subnet_requirements` table | min_vram_gb, cuda_version, ram_gb, cpu_cores, storage_gb, dependencies |
| `gpu_models` table | catalog of available GPUs (vram, price, availability) |
| Analyzer output | extraction_confidence, dependency complexity |

### Scoring Logic

```python
def score_technical(requirements: dict, gpus: list[dict], extraction_confidence: float) -> ScoreComponent:
    """
    Hardware feasibility assessment.
    
    Scoring factors:
    - % of catalog GPUs that meet VRAM requirement (+40)
    - Dependency complexity (fewer = better) (+20)
    - CUDA version compatibility (+15)
    - RAM and storage feasibility (+15)
    - Extraction confidence (+10)
    """
```

### Sub-scores

| Factor | Weight | Calculation |
|--------|--------|-------------|
| GPU Match Rate | 40% | `(eligible_gpus / total_gpus) * 100` |
| Dependency Simplicity | 20% | `100 - (dependency_count * 5)` |
| CUDA Compatibility | 15% | `100 if cuda_version <= latest_driver else 50` |
| Resource Feasibility | 15% | `(ram_score + storage_score) / 2` |
| Data Confidence | 10% | `extraction_confidence * 100` |

---

## Pillar 3: Economics (35%)

**Question:** Will this subnet be profitable?

### Inputs
| Source | Data |
|--------|------|
| `subnet_metrics` table | emission, average_incentive, total_stake, top_5_concentration |
| `market_data` table | tao_price_usd, alpha_price_1d_change, liquidity |
| GPU pricing | hourly cost from provider offers |

### Scoring Logic

```python
def score_economics(metrics: dict, market: dict, gpu_cost_hourly: float) -> ScoreComponent:
    """
    Financial viability assessment.
    
    Scoring factors:
    - Revenue potential (emissions * incentive * TAO price) (+30)
    - Competition concentration (lower = better) (+20)
    - Reward stability (top vs median spread) (+15)
    - GPU cost vs expected revenue (+20)
    - Market momentum (price change, liquidity) (+15)
    """
```

### Sub-scores

| Factor | Weight | Calculation |
|--------|--------|-------------|
| Revenue Potential | 30% | `(daily_revenue_usd / 50) * 100` capped at 100 |
| Competition Health | 20% | `100 - (top_5_concentration * 60)` |
| Reward Stability | 15% | `100 - (spread_ratio * 30)` |
| Cost Efficiency | 20% | `(revenue / (gpu_cost * 730)) * 100` |
| Market Momentum | 15% | `50 + (price_change * 2) + (liquidity / 1e4)` |

---

## Opportunity Score Computation

```python
def compute_opportunity_score(
    utility_score: float,
    technical_score: float,
    economics_score: float,
) -> dict:
    weights = {
        "utility": 0.30,
        "technical": 0.35,
        "economics": 0.35,
    }
    
    total = (
        utility_score * weights["utility"] +
        technical_score * weights["technical"] +
        economics_score * weights["economics"]
    )
    
    return {
        "total_score": clamp(total, 0, 100),
        "pillar_scores": {
            "utility": utility_score,
            "technical": technical_score,
            "economics": economics_score,
        },
        "weights": weights,
        "model_version": "v2.0",
    }
```

---

## Decision Mapping

| Score | Decision | Action |
|-------|----------|--------|
| ≥ 75 | **RUN** | Deploy miner on this subnet |
| 40-74 | **WATCH** | Monitor for improvement |
| < 40 | **AVOID** | Do not deploy; exit if running |

### Mapping from v1.0

| v1.0 (ENTER/HOLD/EXIT) | v2.0 (RUN/WATCH/AVOID) |
|-------------------------|------------------------|
| ENTER (≥75) | RUN |
| WATCH (40-74) | WATCH |
| EXIT (<40) | AVOID |

---

## API Response Format

```json
{
  "total_score": 72.5,
  "model_version": "v2.0",
  "decision": "WATCH",
  "pillar_scores": {
    "utility": 68.0,
    "technical": 82.0,
    "economics": 65.0
  },
  "weights": {
    "utility": 0.30,
    "technical": 0.35,
    "economics": 0.35
  },
  "components": [
    {
      "pillar": "utility",
      "name": "problem_clarity",
      "score": 75.0,
      "explanation": "Subnet solves a clear problem in the Bittensor ecosystem."
    },
    {
      "pillar": "technical",
      "name": "gpu_match_rate",
      "score": 85.0,
      "explanation": "17 of 20 catalog GPUs meet the 8GB VRAM requirement."
    },
    {
      "pillar": "economics",
      "name": "revenue_potential",
      "score": 60.0,
      "explanation": "Estimated $42/day revenue at current TAO price."
    }
  ],
  "summary": "Opportunity Score 72.5/100 — WATCH. Strong technical feasibility, moderate economics."
}
```

---

## Database Schema Changes

### New Columns on `opportunity_scores`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `utility_score` | FLOAT | YES | Pillar 1 score (0-100) |
| `technical_score` | FLOAT | YES | Pillar 2 score (0-100) |
| `economics_score` | FLOAT | YES | Pillar 3 score (0-100) |
| `pillar_version` | VARCHAR(10) | YES | "v2.0" for 3-pillar scores |
| `decision` VARCHAR(10) | YES | "RUN", "WATCH", or "AVOID" |

### New Table: `utility_assessments`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | NO | Primary key |
| `netuid` | INTEGER | YES | Subnet identifier |
| `problem_clarity` | FLOAT | YES | Does it solve a real problem? |
| `uniqueness` | FLOAT | YES | Is it unique or a copycat? |
| `description_quality` | FLOAT | YES | Is the description clear? |
| `development_activity` | FLOAT | YES | Is there active development? |
| `tokenomics_score` | FLOAT | YES | Are tokenomics sound? |
| `governance_score` | FLOAT | YES | Is governance decentralized? |
| `overall_utility` | FLOAT | YES | Weighted utility score |
| `assessed_at` | TIMESTAMP | NO | Assessment timestamp |

---

## Migration Path

### Phase 1: Backward Compatibility
- Keep v1.0 scoring available at `/api/opportunities/v1/{netuid}/score`
- Add v2.0 scoring at `/api/opportunities/v2/{netuid}/score`
- Frontend can toggle between views

### Phase 2: Default Switch
- Once v2.0 is validated, make it the default
- v1.0 available at `/api/v1/opportunities/{netuid}/score` (legacy)

### Phase 3: Full Migration
- Remove v1.0 scoring after 30-day overlap
- All scores use v2.0 pillar model

---

## Configuration

```python
# backend/app/intelligence/__init__.py

SCORE_MODEL_VERSION = "v2.0"

PILLAR_WEIGHTS = {
    "utility": 0.30,
    "technical": 0.35,
    "economics": 0.35,
}

DECISION_THRESHOLDS = {
    "run": 75.0,     # Score >= 75 → RUN
    "watch": 40.0,   # Score >= 40 → WATCH
    # Below 40 → AVOID
}
```

---

## Testing

```python
# tests/intelligence/test_v2_scoring.py

def test_utility_score_calculation():
    """Utility pillar produces correct score."""
    
def test_technical_score_calculation():
    """Technical pillar produces correct score."""
    
def test_economics_score_calculation():
    """Economics pillar produces correct score."""
    
def test_opportunity_score_combination():
    """Three pillars combine correctly with weights."""
    
def test_decision_mapping():
    """Score bands map to correct decisions."""
    
def test_backward_compatibility():
    """v1.0 scores still available."""
```
