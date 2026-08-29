# Scoring API Reference

> Last updated: 2026-08-29 — v2.0 3-pillar model

---

## Endpoints

### Compute Opportunity Score (v2.0)

```
POST /api/v2/opportunities/score
```

Compute a subnet opportunity score using the 3-pillar model.

**Request Body:**
```json
{
  "netuid": 1,
  "include_components": true
}
```

**Response:**
```json
{
  "netuid": 1,
  "subnet_name": "text-prompting",
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
      "weight": 0.30,
      "explanation": "Subnet solves a clear problem in the Bittensor ecosystem."
    },
    {
      "pillar": "utility",
      "name": "uniqueness",
      "score": 60.0,
      "weight": 0.20,
      "explanation": "Competes with 3 other text-based subnets."
    },
    {
      "pillar": "technical",
      "name": "gpu_match_rate",
      "score": 85.0,
      "weight": 0.40,
      "explanation": "17 of 20 catalog GPUs meet the 8GB VRAM requirement."
    },
    {
      "pillar": "technical",
      "name": "dependency_simplicity",
      "score": 80.0,
      "weight": 0.20,
      "explanation": "Only 3 core dependencies (torch, transformers, bittensor)."
    },
    {
      "pillar": "economics",
      "name": "revenue_potential",
      "score": 60.0,
      "weight": 0.30,
      "explanation": "Estimated $42/day revenue at current TAO price."
    },
    {
      "pillar": "economics",
      "name": "competition_health",
      "score": 70.0,
      "weight": 0.20,
      "explanation": "Top-5 miners hold 35% of incentive — moderate concentration."
    }
  ],
  "summary": "Opportunity Score 72.5/100 — WATCH. Strong technical feasibility, moderate economics.",
  "calculated_at": "2026-08-29T13:47:00Z"
}
```

---

### Get Decision

```
GET /api/opportunities/{netuid}/decision
```

Get the current decision (RUN/WATCH/AVOID) for a subnet.

**Response:**
```json
{
  "netuid": 1,
  "decision": "WATCH",
  "score": 72.5,
  "pillar_scores": {
    "utility": 68.0,
    "technical": 82.0,
    "economics": 65.0
  },
  "constraints_violated": [],
  "approval_level": "L1_auto",
  "reason": "Good technical feasibility but economics need improvement."
}
```

---

### List All Decisions

```
GET /api/opportunities/decisions
```

List decisions for all scored subnets.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `decision` | string | — | Filter by decision (RUN, WATCH, AVOID) |
| `min_score` | number | — | Minimum score filter |
| `max_score` | number | — | Maximum score filter |
| `page` | integer | 1 | Page number |
| `page_size` | integer | 20 | Items per page |

**Response:**
```json
{
  "data": [
    {
      "netuid": 1,
      "subnet_name": "text-prompting",
      "decision": "RUN",
      "score": 82.5,
      "pillar_scores": {
        "utility": 85.0,
        "technical": 90.0,
        "economics": 72.0
      }
    },
    {
      "netuid": 3,
      "subnet_name": "image-alchemy",
      "decision": "WATCH",
      "score": 62.0,
      "pillar_scores": {
        "utility": 55.0,
        "technical": 78.0,
        "economics": 52.0
      }
    }
  ],
  "meta": {
    "page": 1,
    "page_size": 20,
    "total_items": 2,
    "total_pages": 1,
    "has_next": false,
    "has_prev": false
  }
}
```

---

### Get Watchlist

```
GET /api/opportunities/watchlist
```

Get all subnets in WATCH state, sorted by score.

**Response:**
```json
{
  "data": [
    {
      "netuid": 3,
      "subnet_name": "image-alchemy",
      "score": 62.0,
      "decision": "WATCH",
      "watch_reason": "Economics weak due to high GPU costs",
      "alert_threshold": 75
    }
  ],
  "meta": {
    "total_items": 1
  }
}
```

---

### Trigger Scoring Run

```
POST /api/opportunities/score-all
```

Trigger a full scoring run for all known subnets.

**Response:**
```json
{
  "status": "scoring_started",
  "netuids": [1, 3, 64],
  "estimated_seconds": 30
}
```

---

### Get Score History

```
GET /api/opportunities/{netuid}/history
```

Get historical scores for a subnet.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `days` | integer | 30 | Number of days of history |
| `pillar` | string | — | Filter by pillar (utility, technical, economics) |

**Response:**
```json
{
  "netuid": 1,
  "history": [
    {
      "date": "2026-08-29",
      "total_score": 72.5,
      "utility_score": 68.0,
      "technical_score": 82.0,
      "economics_score": 65.0,
      "decision": "WATCH"
    },
    {
      "date": "2026-08-28",
      "total_score": 70.0,
      "utility_score": 65.0,
      "technical_score": 80.0,
      "economics_score": 62.0,
      "decision": "WATCH"
    }
  ]
}
```

---

### Compare Subnets

```
POST /api/opportunities/compare
```

Compare multiple subnets side by side.

**Request Body:**
```json
{
  "netuids": [1, 3, 64]
}
```

**Response:**
```json
{
  "comparison": [
    {
      "netuid": 1,
      "subnet_name": "text-prompting",
      "total_score": 72.5,
      "decision": "WATCH",
      "pillar_scores": {
        "utility": 68.0,
        "technical": 82.0,
        "economics": 65.0
      }
    },
    {
      "netuid": 3,
      "subnet_name": "image-alchemy",
      "total_score": 62.0,
      "decision": "WATCH",
      "pillar_scores": {
        "utility": 55.0,
        "technical": 78.0,
        "economics": 52.0
      }
    },
    {
      "netuid": 64,
      "subnet_name": "finetune",
      "total_score": 28.5,
      "decision": "AVOID",
      "pillar_scores": {
        "utility": 25.0,
        "technical": 45.0,
        "economics": 15.0
      }
    }
  ],
  "best": {
    "netuid": 1,
    "reason": "Highest total score with strong technical feasibility"
  }
}
```

---

## Legacy Endpoints (v1.0)

### Get v1.0 Score

```
GET /api/v1/opportunities/{netuid}/score
```

Returns the v1.0 8-component score (deprecated).

**Response:**
```json
{
  "netuid": 1,
  "total_score": 68.0,
  "model_version": "v1.0",
  "components": [
    {
      "name": "economic_potential",
      "score": 72.0,
      "weight": 0.20,
      "weighted": 14.4,
      "explanation": "Emission 0.0500 α/block..."
    }
  ],
  "summary": "Opportunity Score 68/100 (model v1.0)..."
}
```

---

## Error Responses

| Status | Code | Message | Resolution |
|--------|------|---------|------------|
| 404 | `subnet_not_found` | Subnet {netuid} not found | Check netuid is valid |
| 422 | `insufficient_data` | Not enough data to score | Run scanner and analyzer first |
| 429 | `rate_limited` | Too many requests | Wait and retry |
| 500 | `scoring_error` | Internal scoring error | Check logs |

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `POST /api/v2/opportunities/score` | 60/minute |
| `GET /api/opportunities/{netuid}/decision` | 120/minute |
| `GET /api/opportunities/decisions` | 60/minute |
| `POST /api/opportunities/score-all` | 10/hour |

---

## Webhooks (Future)

Score change notifications via webhook:

```json
{
  "event": "score.changed",
  "data": {
    "netuid": 1,
    "previous_score": 68.0,
    "new_score": 72.5,
    "previous_decision": "WATCH",
    "new_decision": "WATCH",
    "pillar_changes": {
      "utility": "+3.0",
      "technical": "+2.0",
      "economics": "+5.0"
    }
  },
  "timestamp": "2026-08-29T13:47:00Z"
}
```
